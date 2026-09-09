/**
 * Notion, read-only.
 *
 * Notion stays the canonical wishlist. This app reads it and never writes back,
 * which is why the integration only needs read access and why nothing here can
 * damage the source of truth.
 *
 * The page is written for a person. It might hold a table, a bulleted list, a
 * child database, or all three under a heading. So the reader walks the blocks
 * under the relevant heading and takes whatever it finds.
 */

import 'server-only';

import { Client, isFullBlock, isFullPage } from '@notionhq/client';
import type {
  BlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { notionConfig } from '@/lib/env';
import {
  isHorizonHeading,
  isOpenReviewHeading,
  parseRow,
  type ParsedWishlistItem,
} from './parse';

export type NotionErrorKind =
  | 'NOT_CONFIGURED'
  | 'UNAUTHORISED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE';

export class NotionError extends Error {
  readonly kind: NotionErrorKind;
  readonly userMessage: string;

  constructor(kind: NotionErrorKind, message: string) {
    super(message);
    this.name = 'NotionError';
    this.kind = kind;
    this.userMessage = MESSAGES[kind];
  }
}

const MESSAGES: Record<NotionErrorKind, string> = {
  NOT_CONFIGURED:
    'Notion is not connected. Add NOTION_TOKEN and NOTION_PAGE_ID, or keep using the local wishlist.',
  UNAUTHORISED:
    'Notion rejected the token. Check it is valid and that the page has been shared with the integration.',
  NOT_FOUND:
    'Notion could not find that page. Check NOTION_PAGE_ID, and that the integration has been invited to the page.',
  RATE_LIMITED: 'Notion is rate limiting requests. Try the sync again shortly.',
  UNAVAILABLE: 'Notion could not be reached. The local wishlist is unaffected.',
};

export function notionConfigured(): boolean {
  return notionConfig() !== null;
}

function client(): Client {
  const config = notionConfig();
  if (!config) throw new NotionError('NOT_CONFIGURED', 'Notion is not configured');
  return new Client({ auth: config.token });
}

/** Notion ids appear with and without dashes. Normalise to dashed form. */
export function normalisePageId(raw: string): string {
  const hex = raw.trim().replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) return raw.trim();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function plain(rich: readonly RichTextItemResponse[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text).join('').trim();
}

function blockText(block: BlockObjectResponse): string {
  switch (block.type) {
    case 'heading_1':
      return plain(block.heading_1.rich_text);
    case 'heading_2':
      return plain(block.heading_2.rich_text);
    case 'heading_3':
      return plain(block.heading_3.rich_text);
    case 'paragraph':
      return plain(block.paragraph.rich_text);
    case 'bulleted_list_item':
      return plain(block.bulleted_list_item.rich_text);
    case 'numbered_list_item':
      return plain(block.numbered_list_item.rich_text);
    case 'to_do':
      return plain(block.to_do.rich_text);
    case 'toggle':
      return plain(block.toggle.rich_text);
    case 'callout':
      return plain(block.callout.rich_text);
    case 'child_page':
      return block.child_page.title;
    case 'child_database':
      return block.child_database.title;
    default:
      return '';
  }
}

function headingLevel(block: BlockObjectResponse): number | null {
  if (block.type === 'heading_1') return 1;
  if (block.type === 'heading_2') return 2;
  if (block.type === 'heading_3') return 3;
  return null;
}

async function listChildren(notion: Client, blockId: string): Promise<BlockObjectResponse[]> {
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of response.results) {
      if (isFullBlock(block)) out.push(block);
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return out;
}

export interface NotionWishlistResult {
  items: ParsedWishlistItem[];
  /** Text of any "Open system reviews" section found, for context. */
  openReviews: string[];
  pageTitle: string | null;
  /** True when the horizon heading was found. False means we read the page but
   *  could not find that section, which is a different problem to a failure. */
  sectionFound: boolean;
}

/**
 * Read the wishlist.
 *
 * Every Notion failure is translated into a NotionError with a sentence that
 * says what to do. The caller keeps working from the local cache either way:
 * Notion being down is never allowed to take the Shopping screen with it.
 */
export async function fetchNotionWishlist(): Promise<NotionWishlistResult> {
  const config = notionConfig();
  if (!config) throw new NotionError('NOT_CONFIGURED', 'Notion is not configured');

  const notion = client();
  const pageId = normalisePageId(config.pageId);

  try {
    let pageTitle: string | null = null;
    try {
      const page = await notion.pages.retrieve({ page_id: pageId });
      if (isFullPage(page)) pageTitle = titleOf(page);
    } catch {
      // A database id rather than a page id, or a page whose title we cannot
      // read. Neither stops us reading the blocks.
    }

    const blocks = await listChildren(notion, pageId);

    const items: ParsedWishlistItem[] = [];
    const openReviews: string[] = [];
    let sectionFound = false;

    let mode: 'none' | 'horizon' | 'reviews' = 'none';
    let sectionLevel = 99;

    for (const block of blocks) {
      const level = headingLevel(block);
      const text = blockText(block);

      if (level !== null) {
        if (isHorizonHeading(text)) {
          mode = 'horizon';
          sectionFound = true;
          sectionLevel = level;
          continue;
        }
        if (isOpenReviewHeading(text)) {
          mode = 'reviews';
          sectionLevel = level;
          continue;
        }
        // A heading at the same or higher level ends the current section.
        if (level <= sectionLevel) mode = 'none';
        continue;
      }

      if (mode === 'none') continue;

      if (mode === 'reviews') {
        if (text) openReviews.push(text);
        continue;
      }

      // --- Inside the horizon section ---
      if (block.type === 'table') {
        const rows = await listChildren(notion, block.id);
        for (const row of rows) {
          if (row.type !== 'table_row') continue;
          const cells = row.table_row.cells.map((cell) => plain(cell));
          const parsed = parseRow(row.id, cells);
          if (parsed) items.push(parsed);
        }
        continue;
      }

      if (block.type === 'child_database') {
        const rows = await queryDatabase(notion, block.id);
        items.push(...rows);
        continue;
      }

      if (
        block.type === 'bulleted_list_item' ||
        block.type === 'numbered_list_item' ||
        block.type === 'to_do'
      ) {
        const parsed = parseRow(block.id, [text]);
        if (parsed) {
          if (block.type === 'to_do' && block.to_do.checked) parsed.status = 'BOUGHT';
          items.push(parsed);
        }
      }
    }

    // No recognised heading: fall back to any table on the page, so a page
    // that was restructured still produces something useful.
    if (!sectionFound && items.length === 0) {
      for (const block of blocks) {
        if (block.type !== 'table') continue;
        const rows = await listChildren(notion, block.id);
        for (const row of rows) {
          if (row.type !== 'table_row') continue;
          const parsed = parseRow(
            row.id,
            row.table_row.cells.map((cell) => plain(cell)),
          );
          if (parsed) items.push(parsed);
        }
      }
    }

    return { items, openReviews, pageTitle, sectionFound };
  } catch (error) {
    throw translate(error);
  }
}

async function queryDatabase(notion: Client, databaseId: string): Promise<ParsedWishlistItem[]> {
  const out: ParsedWishlistItem[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!isFullPage(page)) continue;
      const cells: string[] = [titleOf(page) ?? ''];

      for (const [name, property] of Object.entries(page.properties)) {
        switch (property.type) {
          case 'rich_text':
            cells.push(plain(property.rich_text));
            break;
          case 'number':
            if (property.number !== null) cells.push(`${name}: $${property.number}`);
            break;
          case 'select':
            if (property.select) cells.push(property.select.name);
            break;
          case 'multi_select':
            cells.push(property.multi_select.map((s) => s.name).join(' '));
            break;
          case 'status':
            if (property.status) cells.push(property.status.name);
            break;
          case 'url':
            if (property.url) cells.push(property.url);
            break;
          case 'checkbox':
            if (property.checkbox) cells.push('bought');
            break;
          default:
            break;
        }
      }

      const parsed = parseRow(page.id, cells);
      if (parsed) out.push(parsed);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return out;
}

function titleOf(page: PageObjectResponse): string | null {
  for (const property of Object.values(page.properties)) {
    if (property.type === 'title') return plain(property.title) || null;
  }
  return null;
}

function translate(error: unknown): NotionError {
  if (error instanceof NotionError) return error;

  const code = (error as { code?: string })?.code;
  const status = (error as { status?: number })?.status;

  if (code === 'unauthorized' || status === 401) {
    return new NotionError('UNAUTHORISED', 'Notion rejected the token');
  }
  if (code === 'object_not_found' || status === 404) {
    return new NotionError('NOT_FOUND', 'Notion page not found');
  }
  if (code === 'rate_limited' || status === 429) {
    return new NotionError('RATE_LIMITED', 'Notion rate limited the request');
  }
  return new NotionError('UNAVAILABLE', `Notion request failed: ${String(error)}`);
}

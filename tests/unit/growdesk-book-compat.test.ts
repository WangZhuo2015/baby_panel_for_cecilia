import assert from 'node:assert/strict';
import test from 'node:test';
import { fromGrowDeskBook, compareLegacyBookTitles } from '../../lib/growdesk/book-compat';
import { canonicalBookId, legacyReferenceId } from '../../lib/growdesk/knowledge-legacy-id';

test('book projection preserves legacy flattened fields and removes canonical-only fields', () => {
  const result = fromGrowDeskBook({ details: {
    id: 'book_test', author: ['test_author'], translator: ['test_translator'],
    rating: { score: 0, count: 0, source: 'test_catalog', retrievedDate: '2026-09-19' }, version: '2',
  } });
  assert.equal(result.authorJson, '["test_author"]');
  assert.equal(result.translatorJson, '["test_translator"]');
  assert.equal(result.ratingScore, 0);
  assert.equal(result.ratingCount, 0);
  assert.equal(result.ratingSource, 'test_catalog');
  assert.equal(result.ratingRetrievedDate, '2026-09-19');
  assert.equal('version' in result, false);
  assert.equal('rating' in result, false);
  assert.equal('illustrator' in result, false);
  assert.equal('translator' in result, false);
  assert.deepEqual(result.author, ['test_author']);
});

test('known books use the reproducible legacy row id and PATCH can resolve it', () => {
  const result = fromGrowDeskBook({
    details: {
      id: 'book_from_head_to_toe',
      bookId: 'book_from_head_to_toe',
      title: '从头动到脚',
      author: ['艾瑞·卡尔'],
      illustrator: ['艾瑞·卡尔'],
      translator: ['林良'],
      categories: ['language'],
      interactionSuggestions: [],
      sourceRefs: [],
      rating: { score: null, count: null, source: null, retrievedDate: null },
      version: '0',
    },
  });
  const expectedId = legacyReferenceId('Book', 4);
  assert.equal(result.id, expectedId);
  assert.equal(canonicalBookId(String(result.id)), 'book_from_head_to_toe');
  assert.equal(result.bookId, 'book_from_head_to_toe');
});

test('book list follows legacy database title ordering, not catalogue seed order', () => {
  const books = ['蹦!', '晚安，大猩猩', '小金鱼逃走了', '好饿的毛毛虫', '从头动到脚'].map(title => ({ title }));
  assert.deepEqual(books.sort(compareLegacyBookTitles).map(book => book.title),
    ['从头动到脚', '好饿的毛毛虫', '小金鱼逃走了', '晚安，大猩猩', '蹦!']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { fromGrowDeskBook, compareLegacyBookTitles } from '../../lib/growdesk/book-compat';

test('book projection preserves authors, rating and optimistic version for old UI', () => {
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
  assert.equal(result.version, '2');
  assert.deepEqual(result.author, ['test_author']);
});

test('book list follows legacy database title ordering, not catalogue seed order', () => {
  const books = ['蹦!', '晚安，大猩猩', '小金鱼逃走了', '好饿的毛毛虫', '从头动到脚'].map(title => ({ title }));
  assert.deepEqual(books.sort(compareLegacyBookTitles).map(book => book.title),
    ['从头动到脚', '好饿的毛毛虫', '小金鱼逃走了', '晚安，大猩猩', '蹦!']);
});

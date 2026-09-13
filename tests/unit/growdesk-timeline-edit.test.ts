import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordEditDialog } from '../../components/ui/RecordEditDialog';

test('summary-only timeline cannot render a default feeding edit form', () => {
  const html = renderToStaticMarkup(React.createElement(RecordEditDialog, {
    item: { id: 'test_feed', babyId: 'test_baby', version: '2', type: 'feeding', time: '12:00', title: 'test_feed', icon: '' },
    onClose() {}, async onSubmit() { throw new Error('must not submit'); },
  }));
  assert.match(html, /正在加载完整记录/);
  assert.doesNotMatch(html, /<form|<input/);
});

test('other summary-only records do not render destructive default forms', () => {
  const html = renderToStaticMarkup(React.createElement(RecordEditDialog, {
    item: { id: 'test_sleep', babyId: 'test_baby', type: 'sleep', time: '12:00', title: 'test_sleep', icon: '' },
    onClose() {}, async onSubmit() {},
  }));
  assert.match(html, /暂时无法加载完整记录/);
  assert.doesNotMatch(html, /<form|<input/);
});

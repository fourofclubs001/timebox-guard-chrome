import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardedPattern, matchPattern, normalizePattern } from '../src/sites.js';

test('normalizePattern strips scheme, www, port, query and trailing slash', () => {
  assert.equal(normalizePattern('https://www.YouTube.com/'), 'youtube.com');
  assert.equal(normalizePattern('  reddit.com/r/All/?sort=new#top '), 'reddit.com/r/all');
  assert.equal(normalizePattern('http://localhost:3000/app'), 'localhost/app');
  assert.equal(normalizePattern('m.facebook.com'), 'm.facebook.com');
});

test('normalizePattern rejects things that are not sites', () => {
  for (const bad of ['', '   ', 'youtube', 'not a site', 'chrome://extensions', 'foo..com']) {
    assert.equal(normalizePattern(bad), null, bad);
  }
});

test('matchPattern covers subdomains but not lookalike domains', () => {
  const patterns = ['youtube.com'];
  assert.equal(matchPattern('https://youtube.com/watch?v=1', patterns), 'youtube.com');
  assert.equal(matchPattern('https://m.youtube.com/', patterns), 'youtube.com');
  assert.equal(matchPattern('https://notyoutube.com/', patterns), null);
  assert.equal(matchPattern('https://youtube.com.evil.io/', patterns), null);
});

test('matchPattern path prefixes respect segment boundaries', () => {
  const patterns = ['reddit.com/r/all'];
  assert.equal(matchPattern('https://www.reddit.com/r/all', patterns), 'reddit.com/r/all');
  assert.equal(matchPattern('https://www.reddit.com/r/All/top', patterns), 'reddit.com/r/all');
  assert.equal(matchPattern('https://www.reddit.com/r/allergies', patterns), null);
  assert.equal(matchPattern('https://www.reddit.com/', patterns), null);
});

test('matchPattern prefers the most specific pattern', () => {
  const patterns = ['reddit.com', 'reddit.com/r/all'];
  assert.equal(matchPattern('https://reddit.com/r/all/new', patterns), 'reddit.com/r/all');
  assert.equal(matchPattern('https://reddit.com/r/pics', patterns), 'reddit.com');
});

test('matchPattern ignores non-web URLs', () => {
  assert.equal(matchPattern('chrome://newtab/', ['newtab']), null);
  assert.equal(matchPattern('chrome-extension://abc/prompt.html?site=youtube.com', ['youtube.com']), null);
  assert.equal(matchPattern('not a url', ['youtube.com']), null);
});

test('guardedPattern lets a more specific exception win', () => {
  const guarded = ['youtube.com'];
  const allowed = ['music.youtube.com'];
  assert.equal(guardedPattern('https://www.youtube.com/watch?v=1', guarded, allowed), 'youtube.com');
  assert.equal(guardedPattern('https://m.youtube.com/', guarded, allowed), 'youtube.com');
  assert.equal(guardedPattern('https://music.youtube.com/watch?v=1', guarded, allowed), null);
});

test('guardedPattern: a more specific guarded pattern beats a broader exception', () => {
  assert.equal(guardedPattern('https://reddit.com/r/all', ['reddit.com/r/all'], ['reddit.com']), 'reddit.com/r/all');
  assert.equal(guardedPattern('https://reddit.com/r/pics', ['reddit.com/r/all'], ['reddit.com']), null);
});

test('guardedPattern: the exception wins a tie, and no exceptions behaves like matchPattern', () => {
  assert.equal(guardedPattern('https://youtube.com/', ['youtube.com'], ['youtube.com']), null);
  assert.equal(guardedPattern('https://youtube.com/', ['youtube.com']), 'youtube.com');
  assert.equal(guardedPattern('https://example.com/', ['youtube.com'], ['music.youtube.com']), null);
});

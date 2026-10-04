import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUsername, tierFor, UNAVAILABLE_MESSAGE } from './usernames';

const reason = (n: string) => checkUsername(n).reason;

test('allowed: short names, swears, normal names', () => {
  for (const n of ['b', '3', 'x', '_', 'cool_name', '@B', 'ab', 'q1', 'fuck', 'shit', 'ass', 'asshole',
    'bitch', 'damn', 'fuck_it', 'shithead', 'badass', 'dumbass', 'bastard', 'mustard', 'spicy',
    'raccoon', 'standard', 'pakistan', 'montenegro', 'niger', 'nigeria', 'help_me', 'cool_team',
    'boot', 'betta', 'badminton', 'scunthorpe', 'cocoon', 'tycoon', 'leotard', 'stardust',
    'injunction', 'dragging', 'bragging', 'washes_her', 'the_it_crowd', 'fairy', 'twinkle',
    'homemade', 'homer', 'shoot', 'pass', 'classic', 'assassin', 'cumberland', 'xo', 'b_b', 'gg',
    'zzz', 'a1', 'kickflip', 'spike', 'despicable', 'conspicuous', 'nightowl', 'snowflake']) {
    assert.equal(reason(n), 'ok', `${n} should be allowed`);
  }
});

test('charset and length', () => {
  assert.equal(reason(''), 'empty');
  assert.equal(reason('@'), 'empty');
  assert.equal(reason('a'.repeat(24)), 'ok');
  assert.equal(reason('a'.repeat(25)), 'too_long');
  for (const n of ['no-reply', 'with space', 'émile', 'dot.name', 'аdmin' /* cyrillic a */, 'emoji😀', 'a$b']) {
    assert.equal(reason(n), 'charset', n);
  }
});

test('case-insensitive canonical form', () => {
  assert.equal(checkUsername('CoolName').name, 'coolname');
  assert.equal(checkUsername('  @@Zed ').name, 'zed');
});

test('system reserved names, including obfuscations', () => {
  for (const n of ['admin', 'ADMIN', 'adm1n', '4dmin', 'ad_min', 'admin2', '0admin', 'admin_',
    'realadmin', 'xx_admin_xx', 'aadmin', 'mod', 'm0d', 'mods', 'staff', 'st4ff', 'support',
    'root', 'r00t', 'sudo', 'null', 'undefined', 'void', 'noreply', 'no_reply', 'n0reply',
    'official', 'the_official', 'test', 'test123', 'api', 'sigil', 'sigil_team', 'moderator69',
    'trust', 'security', 'dev', 'd3v', 'me', 'settings']) {
    assert.equal(reason(n), 'reserved', `${n} should be reserved`);
    assert.equal(checkUsername(n).message, UNAVAILABLE_MESSAGE);
  }
});

test('slurs and obfuscated variants are blocked', () => {
  const blocked = [
    // racial
    'nigger', 'n1gger', 'n1gg3r', 'niiigggger', 'nigga', 'n_i_g_g_a', 'xxniggaxx', 'reggin', 'niga',
    'nig', 'coon', 'c00n', 'coons', 'spic', 'sp1c', 'spicspicy', 'chink', 'ch1nk', 'gook', 'kike', 'k1ke',
    'wetback', 'beaner', 'paki', 'p4ki', 'raghead', 'towelhead', 'redskin', 'squaw', 'jap', 'wop',
    'golliwog', 'jigaboo', 'porch_monkey', 'zipperhead',
    // homophobic / transphobic
    'fag', 'f4g', 'faggot', 'fagg0t', 'ffaaggg', 'phaggot', 'dyke', 'dyk3', 'homo', 'h0m0', 'homo_99',
    'big_homo', 'lesbo', 'tranny', 'tr4nny', 'trannie', 'shemale', 'sh3male', 'ladyboy', 'troon',
    'fudgepacker', 'heshe', 'trap',
    // ableist
    'retard', 'r3tard', 'ret4rd', 'retarded', 'reetard', 'tard', 't4rd', 'fucktard', 'libtard',
    'spaz', 'sp4z', 'spastic', 'mongoloid', 'cripple', 'mong', 'retart',
    // hate codes
    'hitler', 'h1tler', 'adolf_hitler', 'siegheil', '1488', 'xx1488xx', 'kkk', 'kkk_member',
    'whitepower', 'wh1te_power', 'nazi', 'n4zi', 'neonazi', 'rahowa', 'hh88',
  ];
  for (const n of blocked) {
    assert.equal(reason(n), 'slur', `${n} should be blocked as slur`);
    assert.equal(checkUsername(n).message, UNAVAILABLE_MESSAGE);
  }
});

test('brands are unavailable', () => {
  for (const n of ['discord', 'd1scord', 'google', 'apple', 'openai', 'discord1', '_paypal_']) {
    assert.equal(reason(n), 'brand', n);
    assert.equal(checkUsername(n).message, UNAVAILABLE_MESSAGE);
  }
  // brand as part of a longer name is fine
  assert.equal(reason('applepie'), 'ok');
  assert.equal(reason('discord_fan'), 'ok');
});

test('check order: reserved before slur before brand', () => {
  assert.equal(reason('admin_fag'), 'reserved');
});

test('tiers', () => {
  assert.equal(tierFor('b'), 'legendary');
  assert.equal(tierFor('ab'), 'legendary');
  assert.equal(tierFor('abc'), 'rare');
  assert.equal(tierFor('abcd'), 'short');
  assert.equal(tierFor('abcde'), 'standard');
  assert.equal(checkUsername('@3').tier, 'legendary');
});

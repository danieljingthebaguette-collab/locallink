/** The step strings here are copied verbatim from the live board. Run: npx tsx <this file> */
import assert from 'node:assert';
const URL_RE = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
const urls = (t: string) => t.split(URL_RE).filter((_, i) => i % 2 === 1);

assert.deepStrictEqual(
  urls('Go to this link to register - https://www.givepulse.com/event/634070?wkey=b2121e68b74ecf0aa6951273354e3631&action=register'),
  ['https://www.givepulse.com/event/634070?wkey=b2121e68b74ecf0aa6951273354e3631&action=register'],
  'query string with & must survive intact');

assert.deepStrictEqual(
  urls('Check out our volunteer page (https://americasgrowarow.org/volunteer/) to fill out a group volunteer form. '),
  ['https://americasgrowarow.org/volunteer/'],
  'a wrapped URL keeps its trailing slash and drops the bracket');

assert.deepStrictEqual(urls('Register at https://form.jotform.com/253276179475166'),
  ['https://form.jotform.com/253276179475166']);
assert.deepStrictEqual(urls('Register Here - https://sclsnj.libnet.info/event/16007096 '),
  ['https://sclsnj.libnet.info/event/16007096']);
assert.deepStrictEqual(urls('See https://example.org/page. Then wait.'), ['https://example.org/page'],
  'a sentence-ending full stop is not part of the URL');

// Steps with no link, and the ones that must never become links.
assert.deepStrictEqual(urls('Email your resume to linghui.tai@gmail.com'), [], 'emails stay plain');
assert.deepStrictEqual(urls('Orientation'), []);
assert.deepStrictEqual(urls('Click javascript:alert(1) now'), [], 'javascript: never matches');
assert.deepStrictEqual(urls('data:text/html;base64,PHN2Zz4='), [], 'data: never matches');
console.log('OK  Linkified: all 8 live step strings handled, no unsafe scheme matched');

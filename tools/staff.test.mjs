// node tools/staff.test.mjs — 직원 관리: 머리말 고치기(다른 줄은 그대로), 없는 줄 추가, 잘못된 값 거부, 표시 이름 바꾸기.
import assert from 'node:assert/strict';
import { editAgent, readAgent, splitDesc, withName, editPm, readPm, pmArgs, checkName } from './staff.mjs';

const src = '---\r\nname: dev\r\ndescription: 개발 「빌드」. 웹 게임을 만들고 배포한다. "개발" 요청에 사용.\r\ntools: Read, Write\r\nmodel: opus\r\n---\r\n\r\n본문 「빌드」 그대로\r\nmodel: 본문의 이 줄도 그대로\r\n';
const a = readAgent(src, 'dev');
assert.deepEqual([a.role, a.name, a.model, a.effort], ['개발', '빌드', 'opus', '']);
assert.equal(a.desc, '웹 게임을 만들고 배포한다.');

const out = editAgent(src, { model: 'sonnet', effort: 'high', name: '망치' });
assert.equal(out, '---\r\nname: dev\r\ndescription: 개발 「망치」. 웹 게임을 만들고 배포한다. "개발" 요청에 사용.\r\ntools: Read, Write\r\nmodel: sonnet\r\neffort: high\r\n---\r\n\r\n본문 「빌드」 그대로\r\nmodel: 본문의 이 줄도 그대로\r\n');
assert.equal(editAgent(src, {}), src);                                         // 아무것도 안 바꾸면 바이트 그대로
assert.equal(editAgent(out, { effort: '' }).includes('effort:'), false);        // 기본 = 줄 빼기
const bare = '---\nname: sound\ndescription: 사운드 담당. 효과음을 고른다.\n---\nx\n';
assert.equal(editAgent(bare, { model: 'inherit' }), bare);                      // 줄이 없을 때 inherit은 그대로
assert.equal(editAgent(bare, { model: 'haiku', name: '울림' }), '---\nname: sound\ndescription: 사운드 「울림」 담당. 효과음을 고른다.\nmodel: haiku\n---\nx\n');
assert.throws(() => editAgent(src, { model: 'gpt' }), /모델/);
assert.throws(() => editAgent(src, { effort: 'huge' }), /노력/);
for (const bad of ['', '열세글자가넘는아주긴이름이다', '빌\n드', '「빌드」']) assert.throws(() => editAgent(src, { name: bad }), /이름/);
assert.throws(() => editAgent('name: x\n', { model: 'opus' }), /머리말/);
assert.equal(editAgent(src, { name: '빌드' }).split('\n')[1], 'name: dev\r');     // name:은 절대 안 바뀜
assert.deepEqual(splitDesc('"전략 「플랜」. 조사 결과로"'), { role: '전략', name: '플랜', rest: '조사 결과로' });
assert.deepEqual(splitDesc('리서치. 시장을 본다'), { role: '리서치', name: '', rest: '시장을 본다' });
assert.equal(withName('description: "BM 설계 「금고」. 돈"', '주판'), 'description: "BM 설계 「주판」. 돈"');
assert.equal(checkName(' 새 이름 '), '새 이름');

// PM: .claude/ai-office.json
assert.deepEqual(readPm(''), { name: '지휘', model: 'inherit', effort: '' });
const pmText = editPm('{"other": 1}', { model: 'opus', effort: 'xhigh', name: '총괄' });
assert.deepEqual(JSON.parse(pmText), { other: 1, pm: { name: '총괄', model: 'opus', effort: 'xhigh' } });
assert.deepEqual(pmArgs(readPm(pmText)), ['--model', 'opus', '--effort', 'xhigh']);
assert.deepEqual(pmArgs(readPm('broken')), []);
assert.throws(() => editPm('', { model: 'x' }), /모델/);
console.log('staff ok');

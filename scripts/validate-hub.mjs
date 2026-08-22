import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [gameData, config, indexHtml, hubSource] = await Promise.all([
  readJson(new URL('data/games.json', root)),
  readJson(new URL('data/hub.config.json', root)),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/hub.js', root), 'utf8')
]);

const games = gameData.games;
const ids = games.map((game) => game.id);
const paths = games.map((game) => game.path);

assert.equal(games.length, 29, 'games 배열은 29개여야 합니다.');
assert.equal(new Set(ids).size, 29, 'game id가 중복되었습니다.');
assert.equal(new Set(paths).size, 29, 'game path가 중복되었습니다.');
assert.ok(games.every((game) => game.status === 'published'), 'published가 아닌 게임이 있습니다.');
assert.ok(games.every((game) => game.path === `/games/${game.slug}/`), 'slug와 path가 일치하지 않습니다.');
assert.deepEqual(config.courseTabs, ['전체', '한국사1', '한국사2']);
assert.deepEqual(config.search.fields, ['title', 'displayTitle', 'shortDescription', 'unit', 'tags']);
assert.deepEqual(
  config.eraNavigation,
  ['고대·남북국', '고려', '조선', '개항과 근대 변동', '대한제국과 국권 침탈', '일제강점기', '해방 이후']
);

const sorted = [...games].sort((a, b) => (
  a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ko-KR')
));
assert.equal(sorted.length, 29, '초기 정렬 결과가 29개가 아닙니다.');
assert.equal(new Set(sorted.map((game) => game.id)).size, 29, '초기 정렬 결과에 중복 카드가 있습니다.');

for (const id of ['G026', 'G027', 'G028', 'G029']) {
  assert.equal(ids.filter((value) => value === id).length, 1, `${id}가 정확히 1회 존재해야 합니다.`);
}
const liberationGroup = config.specialGroups.find((group) => group.id === 'liberation-1945');
assert.deepEqual(liberationGroup?.gameIds, ['G026', 'G027']);

const g028 = games.find((game) => game.id === 'G028');
assert.equal(g028.slug, 'aegukban1938');
assert.equal(g028.title, '열 집을 묶다');
assert.equal(g028.path, '/games/aegukban1938/');
assert.deepEqual(g028.lessonUse, []);
assert.equal(g028.lessonUseStatus, 'unconfirmed');
assert.equal(g028.durationMin, null);
assert.equal(g028.durationMax, null);
assert.equal(g028.durationStatus, 'unconfirmed');
const g029 = games.find((game) => game.id === 'G029');
assert.equal(g029.slug, 'hoesaryeong1912');
assert.equal(g029.title, '허가받으시오 — 1912년, 회사를 세우다');
assert.equal(g029.path, '/games/hoesaryeong1912/');
assert.deepEqual(g029.lessonUse, []);
assert.equal(g029.lessonUseStatus, 'unconfirmed');
assert.equal(g029.durationMin, null);
assert.equal(g029.durationMax, null);
assert.equal(g029.durationStatus, 'unconfirmed');
assert.doesNotMatch(hubSource, /수업 위치 미정|시간 미정/);

assert.match(indexHtml, /href="https:\/\/hischarlie\.tistory\.com"/);
assert.match(indexHtml, /찰리쌤의 스마트 교무실/);
assert.doesNotMatch(indexHtml, /class="game-card"/);
assert.doesNotMatch(indexHtml, /역사를 직접/);
assert.match(hubSource, /\.\/data\/games\.json/);
assert.match(hubSource, /\.\/data\/hub\.config\.json/);
assert.match(hubSource, /card\.href = game\.path/);
assert.match(hubSource, /game\.displayTitle \|\| game\.title/);

const initial = filterGames();
assert.equal(initial.length, 29, 'A. 초기 상태는 29개여야 합니다.');

const course2 = filterGames({ course: '한국사2' });
assert.equal(course2.length, 6, 'B. 한국사2는 6개여야 합니다.');

const course2Intro = filterGames({ course: '한국사2', lessonUse: ['도입'] });
assert.ok(course2Intro.some((game) => game.title === '어느 기관의 일입니까?'), 'C. 한국사2 + 도입에 지정 게임이 없습니다.');

const evidence = filterGames({ activityType: ['자료·판단'] });
assert.equal(evidence.length, 6, 'D. 자료·판단은 6개여야 합니다.');

const short = filterGames({ duration: 'short' });
assert.equal(short.length, 5, 'E. 10분 이내는 5개여야 합니다.');
assert.ok(short.every((game) => game.durationMax <= 10), 'E. 10분 초과 게임이 포함되었습니다.');

const gabo = filterGames({ search: '갑오' });
assert.ok(gabo.some((game) => game.id === 'G017'), 'F. 갑오 검색에서 G017을 찾지 못했습니다.');

const gendarme = filterGames({ search: '헌병' });
assert.ok(gendarme.some((game) => game.id === 'G024'), 'G. 헌병 검색에서 G024를 찾지 못했습니다.');

const tagSearch = filterGames({ search: '애국반' });
assert.deepEqual(tagSearch.map((game) => game.id), ['G028'], 'tags 검색에서 G028을 찾지 못했습니다.');
assert.ok(!filterGames({ lessonUse: ['도입'] }).some((game) => game.id === 'G028'), '미확정 lessonUse가 필터에 포함되었습니다.');
assert.ok(!filterGames({ duration: 'short' }).some((game) => game.id === 'G028'), '미확정 duration이 필터에 포함되었습니다.');

const empty = filterGames({ search: '존재하지않는검색어' });
assert.equal(empty.length, 0, 'H. 0개 결과 시나리오가 비어 있지 않습니다.');
assert.equal(filterGames().length, 29, 'I. 초기화 상태가 29개로 복원되지 않습니다.');

const courseCounts = countBy(games, 'course');
const activityCounts = countBy(games, 'activityType');

console.log('Hub v2 validation PASS');
console.log(`Games: ${games.length}`);
console.log(`Duplicate ids: ${games.length - new Set(ids).size}`);
console.log(`Duplicate paths: ${games.length - new Set(paths).size}`);
console.log(`Courses: ${JSON.stringify(courseCounts)}`);
console.log(`Activity types: ${JSON.stringify(activityCounts)}`);
console.log('Regression scenarios A-I + G028/G029 contracts: PASS');

function filterGames(overrides = {}) {
  const state = {
    course: '전체',
    search: '',
    lessonUse: [],
    activityType: [],
    duration: null,
    ...overrides
  };
  const query = state.search.toLocaleLowerCase('ko-KR');

  return games.filter((game) => {
    const course = state.course === '전체' || game.course === state.course;
    const gameLessonUse = Array.isArray(game.lessonUse) ? game.lessonUse : [];
    const lesson = state.lessonUse.length === 0 || state.lessonUse.some((value) => gameLessonUse.includes(value));
    const activity = state.activityType.length === 0 || state.activityType.includes(game.activityType);
    const hasConfirmedDuration = Number.isFinite(game.durationMax);
    const duration = !state.duration || (hasConfirmedDuration && (
      (state.duration === 'short' && game.durationMax <= 10)
      || (state.duration === 'medium' && game.durationMax > 10 && game.durationMax <= 20)
      || (state.duration === 'long' && game.durationMax > 20)
    ));
    const search = !query || config.search.fields.some((field) => {
      const raw = game[field];
      const value = Array.isArray(raw) ? raw.join(' ') : String(raw || '');
      return value.toLocaleLowerCase('ko-KR').includes(query);
    });
    return course && lesson && activity && duration && search;
  });
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

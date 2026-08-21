'use strict';

const DATA_URLS = ['./data/games.json', './data/hub.config.json'];
const DEFAULT_STATE = Object.freeze({
  course: '전체',
  search: '',
  lessonUse: [],
  activityType: [],
  duration: null
});

let games = [];
let config = null;
let state = cloneDefaultState();

const dom = {
  activeFilters: document.getElementById('active-filters'),
  activeRow: document.getElementById('active-row'),
  courseTabs: document.getElementById('course-tabs'),
  emptyReset: document.getElementById('empty-reset'),
  emptyState: document.getElementById('empty-state'),
  eraNavigation: document.getElementById('era-navigation'),
  errorState: document.getElementById('error-state'),
  filterApply: document.getElementById('filter-apply'),
  filterClose: document.getElementById('filter-close'),
  filterControls: document.getElementById('filter-controls'),
  filterCount: document.getElementById('filter-count'),
  filterDialog: document.getElementById('filter-dialog'),
  filterOpen: document.getElementById('filter-open'),
  filterReset: document.getElementById('filter-reset'),
  heroDescription: document.getElementById('hero-description'),
  heroHeadline: document.getElementById('hero-headline'),
  hubSections: document.getElementById('hub-sections'),
  loadingState: document.getElementById('loading-state'),
  resetAll: document.getElementById('reset-all'),
  resetInline: document.getElementById('reset-inline'),
  resultCount: document.getElementById('result-count'),
  search: document.getElementById('game-search'),
  siteName: document.getElementById('site-name')
};

function cloneDefaultState() {
  return { ...DEFAULT_STATE, lessonUse: [], activityType: [] };
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function loadData() {
  const responses = await Promise.all(DATA_URLS.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} 요청 실패: ${response.status}`);
    return response.json();
  }));

  const [gameData, hubConfig] = responses;
  if (!Array.isArray(gameData.games)) throw new TypeError('games.json의 games 배열이 없습니다.');
  if (!Array.isArray(hubConfig.eraNavigation)) throw new TypeError('hub.config.json의 eraNavigation 배열이 없습니다.');
  return { gameData, hubConfig };
}

function getFilterConfig(id) {
  const filter = config.filters.find((item) => item.id === id);
  if (!filter) throw new Error(`필터 설정을 찾을 수 없습니다: ${id}`);
  return filter;
}

function normalizeState(nextState) {
  const courseTabs = new Set(config.courseTabs);
  const lessonOptions = new Set(getFilterConfig('lessonUse').options);
  const activityOptions = new Set(getFilterConfig('activityType').options);
  const durationOptions = new Set(getFilterConfig('duration').options.map((option) => option.id));

  return {
    course: courseTabs.has(nextState.course) ? nextState.course : DEFAULT_STATE.course,
    search: String(nextState.search || '').trimStart(),
    lessonUse: [...new Set(nextState.lessonUse)].filter((value) => lessonOptions.has(value)),
    activityType: [...new Set(nextState.activityType)].filter((value) => activityOptions.has(value)),
    duration: durationOptions.has(nextState.duration) ? nextState.duration : null
  };
}

function matchesDuration(game, duration) {
  if (!duration) return true;
  if (!Number.isFinite(game.durationMax)) return false;
  if (duration === 'short') return game.durationMax <= 10;
  if (duration === 'medium') return game.durationMax > 10 && game.durationMax <= 20;
  if (duration === 'long') return game.durationMax > 20;
  return false;
}

function filterGames() {
  const query = state.search.trim().toLocaleLowerCase('ko-KR');

  return games.filter((game) => {
    const matchesCourse = state.course === '전체' || game.course === state.course;
    const gameLessonUse = Array.isArray(game.lessonUse) ? game.lessonUse : [];
    const matchesLesson = state.lessonUse.length === 0
      || state.lessonUse.some((value) => gameLessonUse.includes(value));
    const matchesActivity = state.activityType.length === 0
      || state.activityType.includes(game.activityType);
    const matchesTime = matchesDuration(game, state.duration);
    const matchesSearch = !query || config.search.fields.some((field) => {
      const value = game[field];
      const searchable = Array.isArray(value) ? value.join(' ') : String(value || '');
      return searchable.toLocaleLowerCase('ko-KR').includes(query);
    });
    return matchesCourse && matchesLesson && matchesActivity && matchesTime && matchesSearch;
  });
}

function sortGames(items) {
  return [...items].sort((a, b) => (
    a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ko-KR')
  ));
}

function formatDuration(game) {
  if (!Number.isFinite(game.durationMin) || !Number.isFinite(game.durationMax)) return null;
  return game.durationMin === game.durationMax
    ? `${game.durationMin}분`
    : `${game.durationMin}~${game.durationMax}분`;
}

function createCardChip(label, modifier = '') {
  return createElement('span', `card-chip${modifier ? ` ${modifier}` : ''}`, label);
}

function renderGameCard(game, headingLevel = 'h3') {
  const card = createElement('a', 'game-card');
  card.href = game.path;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.dataset.gameId = game.id;

  card.appendChild(createElement('p', 'card-eyebrow', game.unit || game.periodLabel));
  card.appendChild(createElement(headingLevel, 'card-title', game.displayTitle || game.title));
  if (game.shortDescription) {
    card.appendChild(createElement('p', 'card-description', game.shortDescription));
  }

  const chips = createElement('div', 'card-chips');
  chips.appendChild(createCardChip(game.activityType, 'card-chip--primary'));

  const hasGroupBadge = game.participation === '모둠';
  const hasVariant = Boolean(game.relatedGroup?.variantLabel);
  const lessonLimit = Math.max(1, 4 - 2 - Number(hasGroupBadge) - Number(hasVariant));
  const gameLessonUse = Array.isArray(game.lessonUse) ? game.lessonUse : [];
  if (gameLessonUse.length) {
    gameLessonUse.slice(0, lessonLimit).forEach((lesson) => {
      chips.appendChild(createCardChip(lesson));
    });
  }
  const durationLabel = formatDuration(game);
  if (durationLabel) chips.appendChild(createCardChip(durationLabel));
  if (hasGroupBadge) chips.appendChild(createCardChip('모둠'));
  if (hasVariant) chips.appendChild(createCardChip(game.relatedGroup.variantLabel, 'card-chip--variant'));

  card.appendChild(chips);
  card.appendChild(createElement('span', 'card-cta', `${config.card.ctaLabel} →`));
  return card;
}

function renderSpecialGroup(groupConfig, groupGames) {
  const group = createElement('div', 'special-group');
  group.appendChild(createElement('p', 'special-group__label', groupConfig.label));
  group.appendChild(createElement('h3', '', groupConfig.headline));
  const grid = createElement('div', 'game-grid');
  sortGames(groupGames).forEach((game) => grid.appendChild(renderGameCard(game, 'h4')));
  group.appendChild(grid);
  return group;
}

function renderEraSection(era, eraGames, eraIndex) {
  const section = createElement('section', 'era-section');
  section.id = `era-${eraIndex + 1}`;
  section.dataset.era = era;

  const heading = createElement('div', 'era-heading');
  heading.appendChild(createElement('h2', '', era));
  heading.appendChild(createElement('p', '', `${eraGames.length}개의 활동`));
  section.appendChild(heading);

  const specialGroups = config.specialGroups.filter((group) => group.section === era);
  const groupedIds = new Set(specialGroups.flatMap((group) => group.gameIds));
  const regularGames = eraGames.filter((game) => !groupedIds.has(game.id));

  if (regularGames.length) {
    const grid = createElement('div', 'game-grid');
    sortGames(regularGames).forEach((game) => grid.appendChild(renderGameCard(game)));
    section.appendChild(grid);
  }

  specialGroups.forEach((groupConfig) => {
    const groupGames = eraGames.filter((game) => groupConfig.gameIds.includes(game.id));
    if (groupGames.length) section.appendChild(renderSpecialGroup(groupConfig, groupGames));
  });
  return section;
}

function renderEraNavigation(erasWithGames) {
  dom.eraNavigation.replaceChildren();
  erasWithGames.forEach(({ era, eraIndex }) => {
    const link = createElement('a', '', era);
    link.href = `#era-${eraIndex + 1}`;
    dom.eraNavigation.appendChild(link);
  });
  dom.eraNavigation.hidden = erasWithGames.length === 0;
}

function updateResultCount(count) {
  dom.resultCount.textContent = `${count}개의 활동`;
}

function buildActiveFilters() {
  const active = [];
  if (state.course !== '전체') active.push({ key: 'course', value: state.course, label: state.course });
  if (state.search.trim()) active.push({ key: 'search', value: state.search, label: `검색: ${state.search.trim()}` });
  state.lessonUse.forEach((value) => active.push({ key: 'lessonUse', value, label: value }));
  state.activityType.forEach((value) => active.push({ key: 'activityType', value, label: value }));
  if (state.duration) {
    const option = getFilterConfig('duration').options.find((item) => item.id === state.duration);
    active.push({ key: 'duration', value: state.duration, label: option.label });
  }
  return active;
}

function removeActiveFilter(key, value) {
  if (key === 'course') state.course = '전체';
  if (key === 'search') {
    state.search = '';
    dom.search.value = '';
  }
  if (key === 'lessonUse' || key === 'activityType') {
    state[key] = state[key].filter((item) => item !== value);
  }
  if (key === 'duration') state.duration = null;
  state = normalizeState(state);
  syncFilterControls();
  renderHub();
}

function renderActiveFilters() {
  const active = buildActiveFilters();
  dom.activeFilters.replaceChildren();
  active.forEach((filter) => {
    const button = createElement('button', 'active-chip');
    button.type = 'button';
    button.setAttribute('aria-label', `${filter.label} 필터 해제`);
    button.appendChild(createElement('span', 'active-chip__label', filter.label));
    button.appendChild(createElement('span', 'active-chip__x', '×'));
    button.addEventListener('click', () => removeActiveFilter(filter.key, filter.value));
    dom.activeFilters.appendChild(button);
  });

  dom.activeRow.hidden = active.length === 0;
  dom.resetInline.hidden = active.length === 0;
  const filterOnlyCount = state.lessonUse.length + state.activityType.length + Number(Boolean(state.duration));
  dom.filterCount.textContent = String(filterOnlyCount);
  dom.filterCount.hidden = filterOnlyCount === 0;
}

function updateCourseTabs() {
  dom.courseTabs.querySelectorAll('[role="tab"]').forEach((tab) => {
    const selected = tab.dataset.course === state.course;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
}

function renderHub() {
  const filtered = sortGames(filterGames());
  dom.hubSections.replaceChildren();
  dom.emptyState.hidden = filtered.length !== 0;

  const erasWithGames = [];
  config.eraNavigation.forEach((era, eraIndex) => {
    const eraGames = filtered.filter((game) => game.era === era);
    if (!eraGames.length) return;
    erasWithGames.push({ era, eraIndex });
    dom.hubSections.appendChild(renderEraSection(era, eraGames, eraIndex));
  });

  renderEraNavigation(erasWithGames);
  updateResultCount(filtered.length);
  renderActiveFilters();
  updateCourseTabs();
}

function resetFilters() {
  state = cloneDefaultState();
  dom.search.value = '';
  syncFilterControls();
  renderHub();
}

function renderCourseTabs() {
  dom.courseTabs.replaceChildren();
  config.courseTabs.forEach((course) => {
    const button = createElement('button', 'course-tab', course);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.course = course;
    button.setAttribute('aria-selected', String(course === state.course));
    button.addEventListener('click', () => {
      state.course = course;
      state = normalizeState(state);
      renderHub();
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...dom.courseTabs.querySelectorAll('[role="tab"]')];
      const currentIndex = tabs.indexOf(button);
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(currentIndex + step + tabs.length) % tabs.length];
      next.click();
      next.focus();
    });
    dom.courseTabs.appendChild(button);
  });
}

function renderFilterControls() {
  dom.filterControls.replaceChildren();
  config.filters.forEach((filter) => {
    const fieldset = createElement('fieldset', 'filter-group');
    fieldset.appendChild(createElement('legend', '', filter.label));
    const options = createElement('div', 'filter-options');

    filter.options.forEach((rawOption) => {
      const option = typeof rawOption === 'string' ? { id: rawOption, label: rawOption } : rawOption;
      const wrapper = createElement('div', 'filter-option');
      const input = document.createElement('input');
      const inputId = `filter-${filter.id}-${String(option.id).replace(/[^a-zA-Z0-9가-힣]/g, '-')}`;
      input.id = inputId;
      input.name = filter.id;
      input.type = filter.mode === 'single' ? 'radio' : 'checkbox';
      input.value = option.id;

      const label = document.createElement('label');
      label.htmlFor = inputId;
      label.textContent = option.label;

      input.addEventListener('change', () => {
        if (filter.mode === 'single') {
          state[filter.id] = input.checked ? input.value : null;
        } else if (input.checked) {
          state[filter.id] = [...state[filter.id], input.value];
        } else {
          state[filter.id] = state[filter.id].filter((value) => value !== input.value);
        }
        state = normalizeState(state);
        renderHub();
      });

      wrapper.append(input, label);
      options.appendChild(wrapper);
    });
    fieldset.appendChild(options);
    dom.filterControls.appendChild(fieldset);
  });
  syncFilterControls();
}

function syncFilterControls() {
  dom.filterControls.querySelectorAll('input').forEach((input) => {
    if (input.name === 'duration') input.checked = state.duration === input.value;
    if (input.name === 'lessonUse' || input.name === 'activityType') {
      input.checked = state[input.name].includes(input.value);
    }
  });
}

function openFilterDialog() {
  if (typeof dom.filterDialog.showModal === 'function') {
    dom.filterDialog.showModal();
    dom.filterOpen.setAttribute('aria-expanded', 'true');
  }
}

function closeFilterDialog() {
  if (dom.filterDialog.open) dom.filterDialog.close();
}

function bindEvents() {
  dom.search.addEventListener('input', () => {
    state.search = dom.search.value;
    state = normalizeState(state);
    renderHub();
  });
  [dom.resetAll, dom.resetInline, dom.emptyReset, dom.filterReset].forEach((button) => {
    button.addEventListener('click', resetFilters);
  });
  dom.filterOpen.addEventListener('click', openFilterDialog);
  dom.filterClose.addEventListener('click', closeFilterDialog);
  dom.filterApply.addEventListener('click', closeFilterDialog);
  dom.filterDialog.addEventListener('close', () => dom.filterOpen.setAttribute('aria-expanded', 'false'));
  dom.filterDialog.addEventListener('click', (event) => {
    if (event.target === dom.filterDialog) closeFilterDialog();
  });
}

function applyConfig() {
  dom.siteName.textContent = config.brand.siteName;
  dom.heroHeadline.textContent = config.brand.headline;
  dom.heroDescription.textContent = config.brand.description;
  dom.search.placeholder = config.search.placeholder;
  document.title = config.brand.siteName;
}

async function init() {
  bindEvents();
  try {
    const data = await loadData();
    games = data.gameData.games.filter((game) => game.status === 'published');
    config = data.hubConfig;
    state = normalizeState(state);
    applyConfig();
    renderCourseTabs();
    renderFilterControls();
    dom.loadingState.hidden = true;
    renderHub();
  } catch (error) {
    console.error('허브 데이터 로딩 실패:', error);
    dom.loadingState.hidden = true;
    dom.errorState.hidden = false;
    dom.resultCount.textContent = '게임 목록을 불러오지 못했습니다.';
  }
}

init();

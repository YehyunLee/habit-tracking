const HABITS_FILE = "Daily Habits Jan-March all.csv";
const ROUTINES_FILE = "LatestRawDataWithTime.csv";

const CATEGORY_COLORS = {
  Career: "#ff6b4a",
  Learning: "#3d74ff",
  Productivity: "#00a7a5",
  Health: "#7cad32",
  "Self-care": "#d78a32",
};
const CATEGORY_LIST = Object.keys(CATEGORY_COLORS);

const HABIT_META = {
  Assignment: { label: "Assignment", category: "Learning" },
  "Code Commit": { label: "Code Commit", category: "Productivity" },
  "Leetcode problem to think about": {
    label: "Leetcode",
    category: "Learning",
  },
  "Prep/Apply 1 US / Big tech": {
    label: "Big Tech Prep",
    category: "Career",
  },
  "Sleep wo alarm": { label: "Sleep w/o Alarm", category: "Health" },
  Study: { label: "Study", category: "Learning" },
  "💪 Exercise": { label: "Exercise", category: "Health" },
  "📔 Write": { label: "Write", category: "Productivity" },
  "📖 Read": { label: "Read", category: "Learning" },
  "🚿 Shower": { label: "Shower", category: "Self-care" },
};

const ACTIVITY_TO_HABIT = {
  Assignment: "Assignment",
  "Code Commit": "Code Commit",
  Leetcode: "Leetcode problem to think about",
  Read: "📖 Read",
  Study: "Study",
  Write: "📔 Write",
  Exercise: "💪 Exercise",
  "Sleep wo alarm": "Sleep wo alarm",
  Shower: "🚿 Shower",
  "Apply 1 US / Big tech": "Prep/Apply 1 US / Big tech",
};

const TIME_ORDER = ["morning", "midday", "afternoon", "evening"];
const MONTH_NAMES = ["January", "February", "March"];
const MONTH_INDEX = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const formatIsoDate = d3.timeFormat("%Y-%m-%d");
const formatShortDate = d3.timeFormat("%b %-d");
const formatLongDate = d3.timeFormat("%b %-d, %Y");
const formatMonth = d3.timeFormat("%B");
const formatMonthShort = d3.timeFormat("%b");
const formatPercent = d3.format(".0%");
const formatDecimal = d3.format(".1f");
const PLAYBACK_SPEEDS = [
  { id: "1x", label: "1x", delay: 1100 },
  { id: "2x", label: "2x", delay: 650 },
  { id: "4x", label: "4x", delay: 320 },
];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  brushedRange: null,
  selectedDateKey: null,
  selectedHabitKey: "💪 Exercise",
  activeCategories: new Set(CATEGORY_LIST),
  activeRangePreset: "all",
  activeStoryPreset: null,
  isPlaying: false,
  playbackSpeed: "2x",
  cumulativeMode: false,
  lastStoryPauseKey: null,
};

const refs = {
  tooltip: d3.select("#tooltip"),
  overview: null,
  storyScroller: null,
  resizeTimer: null,
  playbackTimer: null,
  storyObserver: null,
  storyChartTimer: null,
  storySwapTimer: null,
  storyChartDelayTimer: null,
  storySceneLockUntil: 0,
};

let model = null;

Promise.all([
  d3.csv(encodeURI(HABITS_FILE)),
  d3.csv(encodeURI(ROUTINES_FILE)),
])
  .then(([habitRows, routineRows]) => {
    model = buildModel(habitRows, routineRows);
    state.brushedRange = model.fullRange;
    state.selectedDateKey = formatIsoDate(model.storyStops.perfectDay.date);

    renderHeroStats();
    renderRangeControls();
    renderStoryControls();
    renderCategoryControls();
    renderPlaybackControls();
    renderLegend();
    renderCategoryLegend();
    renderReadingPanel();
    renderStoryScroller();
    initStoryObserver();
    renderOverview();
    refreshPanels();

    window.addEventListener("resize", () => {
      window.clearTimeout(refs.resizeTimer);
      refs.resizeTimer = window.setTimeout(() => {
        renderStoryScroller();
        initStoryObserver();
        renderOverview();
        refreshPanels();
      }, 120);
    });
  })
  .catch((error) => {
    console.error(error);
    d3.select("#selection-summary").html(
      "<p>Something went wrong while loading the datasets. Check the browser console for details.</p>"
    );
  });

function buildModel(habitRows, routineRows) {
  const habitKeys = Object.keys(HABIT_META);

  const days = habitRows
    .filter((row) => row.Date)
    .map((row) => {
      const date = parseReadableDate(row.Date);
      const completions = {};
      const categoryCounts = Object.fromEntries(
        CATEGORY_LIST.map((category) => [category, 0])
      );

      habitKeys.forEach((key) => {
        completions[key] = isYes(row[key]);
        if (completions[key]) {
          categoryCounts[HABIT_META[key].category] += 1;
        }
      });

      return {
        date,
        dateKey: formatIsoDate(date),
        month: formatMonth(date),
        completions,
        categoryCounts,
        total: d3.sum(habitKeys, (key) => Number(completions[key])),
      };
    })
    .sort((a, b) => d3.ascending(a.date, b.date));

  const dayMap = new Map(days.map((day) => [day.dateKey, day]));
  const habits = habitKeys.map((key) => ({
    key,
    label: HABIT_META[key].label,
    category: HABIT_META[key].category,
  }));

  const routineEntries = routineRows
    .map((row) => {
      const date = parseIsoDate(row.date);
      const mappedHabit = ACTIVITY_TO_HABIT[row.activity] || null;

      return {
        date,
        dateKey: formatIsoDate(date),
        timeBlock: row.time_approx,
        activity: row.activity,
        order: Number(row.order_in_day),
        category: row.category,
        habitKey: mappedHabit,
      };
    })
    .sort((a, b) => {
      const dayCompare = d3.ascending(a.date, b.date);
      if (dayCompare !== 0) {
        return dayCompare;
      }
      const timeCompare = d3.ascending(
        TIME_ORDER.indexOf(a.timeBlock),
        TIME_ORDER.indexOf(b.timeBlock)
      );
      return timeCompare || d3.ascending(a.order, b.order);
    });

  const routinesByDate = d3.group(routineEntries, (d) => d.dateKey);
  const monthlyWindows = MONTH_NAMES.map((monthName) => {
    const monthDays = days.filter((day) => day.month === monthName);
    return {
      id: monthName.toLowerCase().slice(0, 3),
      label: monthName,
      range: [monthDays[0].date, monthDays[monthDays.length - 1].date],
    };
  });

  const storyStops = deriveStoryStops(days);
  const overallStats = Object.fromEntries(
    habitKeys.map((key) => [key, computeHabitStats(days, key)])
  );

  const globalStats = {
    totalDays: days.length,
    averageScore: d3.mean(days, (day) => day.total),
    perfectDays: days.filter((day) => day.total === habitKeys.length),
    detailedDays: routinesByDate.size,
  };

  return {
    categories: CATEGORY_LIST,
    days,
    dayMap,
    habits,
    routinesByDate,
    fullRange: [days[0].date, days[days.length - 1].date],
    monthlyWindows,
    storyStops,
    overallStats,
    globalStats,
  };
}

function deriveStoryStops(days) {
  const maxTotal = d3.max(days, (day) => day.total);
  const perfectDay = days.find((day) => day.total === maxTotal);

  const lowestDay = days.reduce((lowest, current) =>
    current.total < lowest.total ? current : lowest
  );

  const reboundCandidates = days.filter(
    (day) =>
      day.date >= lowestDay.date &&
      day.date <= d3.timeDay.offset(lowestDay.date, 7)
  );
  const reboundDay = reboundCandidates.reduce((best, current) =>
    current.total > best.total ? current : best
  );

  const marchDays = days.filter((day) => day.month === "March");
  const marchCrunchDay = marchDays.reduce((lowest, current) =>
    current.total < lowest.total ? current : lowest
  );

  // ── Constellation data: strongest co-completion pair ──
  const habitKeys = Object.keys(HABIT_META);
  let strongestPair = { a: habitKeys[0], b: habitKeys[1], strength: 0, together: 0 };
  for (let i = 0; i < habitKeys.length; i += 1) {
    for (let j = i + 1; j < habitKeys.length; j += 1) {
      let together = 0;
      let either = 0;
      days.forEach((day) => {
        const aDone = day.completions[habitKeys[i]];
        const bDone = day.completions[habitKeys[j]];
        if (aDone || bDone) either += 1;
        if (aDone && bDone) together += 1;
      });
      const strength = either > 0 ? together / either : 0;
      if (strength > strongestPair.strength) {
        strongestPair = { a: habitKeys[i], b: habitKeys[j], strength, together };
      }
    }
  }

  // ── Category Currents data: dominant category ──
  const categoryTotals = {};
  CATEGORY_LIST.forEach((cat) => { categoryTotals[cat] = 0; });
  days.forEach((day) => {
    CATEGORY_LIST.forEach((cat) => {
      categoryTotals[cat] += day.categoryCounts[cat];
    });
  });
  const dominantCategory = CATEGORY_LIST.reduce((best, cat) =>
    categoryTotals[cat] > categoryTotals[best] ? cat : best
  );
  const dominantAvg = categoryTotals[dominantCategory] / days.length;

  return {
    perfectDay,
    reboundDay,
    lowestDay,
    marchCrunchDay,
    strongestPair,
    dominantCategory,
    dominantCategoryAvg: dominantAvg,
  };
}

function getStoryMoments() {
  return [
    {
      id: "perfect",
      label: "Perfect day",
      shortLabel: "Perfect 10/10",
      summary: "The first fully completed day in the season.",
      day: model.storyStops.perfectDay,
      range: [
        d3.timeDay.offset(model.storyStops.perfectDay.date, -3),
        d3.timeDay.offset(model.storyStops.perfectDay.date, 3),
      ],
      habitKey: "💪 Exercise",
      showInControls: true,
    },
    {
      id: "lowest",
      label: "Lowest dip",
      shortLabel: "Lowest dip",
      summary: "The sharpest single-day collapse in the tracker.",
      day: model.storyStops.lowestDay,
      range: [
        d3.timeDay.offset(model.storyStops.lowestDay.date, -2),
        d3.timeDay.offset(model.storyStops.lowestDay.date, 2),
      ],
      habitKey: "Assignment",
      showInControls: false,
    },
    {
      id: "rebound",
      label: "Crash to rebound",
      shortLabel: "Rebound",
      summary: "A fast recovery after the lowest point.",
      day: model.storyStops.reboundDay,
      range: [
        d3.timeDay.offset(model.storyStops.lowestDay.date, -2),
        d3.timeDay.offset(model.storyStops.reboundDay.date, 1),
      ],
      habitKey: "Assignment",
      showInControls: true,
    },
    {
      id: "march",
      label: "March crunch",
      shortLabel: "March crunch",
      summary: "Late-term pressure compresses the routine.",
      day: model.storyStops.marchCrunchDay,
      range: [
        d3.timeDay.offset(model.storyStops.marchCrunchDay.date, -5),
        model.fullRange[1],
      ],
      habitKey: "Study",
      showInControls: true,
    },
  ];
}

function getScrollerScenes() {
  const perfectDay = model.storyStops.perfectDay;
  const lowestDay = model.storyStops.lowestDay;
  const reboundDay = model.storyStops.reboundDay;
  const marchCrunchDay = model.storyStops.marchCrunchDay;

  return [
    {
      id: "opening",
      step: "01",
      tone: "title",
      kicker: "",
      title: "Habit Atlas",
      subtitle: "",
      copy: "",
      showChart: false,
      visual: null,
    },
    {
      id: "season",
      step: "02",
      tone: "narrative",
      kicker: "Chapter 1",
      title: "A few early days reach full capacity.",
      subtitle: `${formatLongDate(perfectDay.date)} becomes the first 10 / 10 day of the season.`,
      copy: "",
      showChart: true,
      visual: {
        type: "line",
        range: model.fullRange,
        band: [
          d3.timeDay.offset(perfectDay.date, -2),
          d3.timeDay.offset(perfectDay.date, 2),
        ],
        points: [
          {
            day: perfectDay,
            label: "10 / 10",
            align: "start",
            dx: 14,
            dy: -18,
          },
        ],
      },
    },
    {
      id: "collapse",
      step: "03",
      tone: "narrative",
      kicker: "Chapter 2",
      title: "Mid-February breaks the routine all at once.",
      subtitle: `${formatLongDate(lowestDay.date)} drops to ${lowestDay.total} / 10 habits completed.`,
      copy: "",
      showChart: true,
      visual: {
        type: "matrix",
        range: [
          d3.timeDay.offset(lowestDay.date, -3),
          d3.timeDay.offset(reboundDay.date, 1),
        ],
        focusDateKey: lowestDay.dateKey,
        focusLabel: "Lowest dip",
        secondaryDateKey: reboundDay.dateKey,
        secondaryLabel: "Rebound",
      },
    },
    {
      id: "rebound",
      step: "04",
      tone: "narrative",
      kicker: "Chapter 3",
      title: "Five days later, the system snaps back.",
      subtitle: `${formatLongDate(reboundDay.date)} rebounds to ${reboundDay.total} / 10.`,
      copy: "",
      showChart: true,
      visual: {
        type: "line",
        range: [
          d3.timeDay.offset(lowestDay.date, -2),
          d3.timeDay.offset(reboundDay.date, 2),
        ],
        band: [lowestDay.date, reboundDay.date],
        points: [
          {
            day: lowestDay,
            label: "1 / 10",
            align: "start",
            dx: 14,
            dy: 24,
          },
          {
            day: reboundDay,
            label: "10 / 10",
            align: "end",
            dx: -14,
            dy: -18,
          },
        ],
      },
    },
    {
      id: "connections",
      step: "05",
      tone: "narrative",
      kicker: "Chapter 4",
      title: "Some routines hold together as clusters, not just streaks.",
      subtitle: "The connection map shows which habits most often get completed on the same days.",
      copy: "",
      showChart: true,
      visual: {
        type: "constellation",
      },
    },
    {
      id: "march",
      step: "06",
      tone: "narrative",
      kicker: "Chapter 5",
      title: "March compresses the routine into only a few categories.",
      subtitle: `${formatLongDate(marchCrunchDay.date)} is the hardest March day at ${marchCrunchDay.total} / 10.`,
      copy: "",
      showChart: true,
      visual: {
        type: "category-bars",
        range: [
          d3.timeDay.offset(marchCrunchDay.date, -6),
          model.fullRange[1],
        ],
        focusDateKey: marchCrunchDay.dateKey,
        focusLabel: "March crunch",
      },
    },
    {
      id: "handoff",
      step: "07",
      tone: "narrative",
      kicker: "Full View",
      title: "The full atlas opens Thomas's daily habit record in more detail.",
      subtitle: "Brush time, compare habits, and inspect the January diary day by day.",
      copy: "",
      showChart: false,
      visual: null,
    },
  ];
}

function renderStoryScroller() {
  const stepsHost = d3.select("#story-step-list");
  if (stepsHost.empty()) {
    return;
  }

  const scenes = getScrollerScenes();
  const activeSceneId = scenes.some(
    (scene) => scene.id === refs.storyScroller?.activeSceneId
  )
    ? refs.storyScroller.activeSceneId
    : scenes[0].id;

  stepsHost
    .selectAll(".story-step")
    .data(scenes, (scene) => scene.id)
    .join("article")
    .attr("class", "story-step")
    .attr("data-scene", (scene) => scene.id)
    .attr("aria-label", (scene) => `${scene.step}. ${scene.title}`)
    .html((scene) => `<span class="visually-hidden">${scene.title}</span>`);

  renderStoryProgress(scenes);

  refs.storyScroller = {
    scenes,
    activeSceneId,
  };

  activateStoryScene(activeSceneId, false);
}

function renderStoryProgress(scenes) {
  d3.select("#story-progress")
    .selectAll(".story-progress-step")
    .data(scenes, (scene) => scene.id)
    .join("span")
    .attr("class", "story-progress-step");
}

function initStoryObserver() {
  if (refs.storyObserver) {
    refs.storyObserver.disconnect();
  }

  const steps = Array.from(document.querySelectorAll(".story-step"));
  if (!steps.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    activateStoryScene(steps[0].dataset.scene, false);
    return;
  }

  refs.storyObserver = new IntersectionObserver(
    (entries) => {
      if (Date.now() < refs.storySceneLockUntil) {
        return;
      }

      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

      if (visible.length) {
        const currentIndex = refs.storyScroller?.scenes.findIndex(
          (scene) => scene.id === refs.storyScroller?.activeSceneId
        ) ?? 0;
        const targetIndex = refs.storyScroller?.scenes.findIndex(
          (scene) => scene.id === visible[0].target.dataset.scene
        ) ?? currentIndex;
        const clampedIndex = Math.max(
          0,
          Math.min(
            refs.storyScroller.scenes.length - 1,
            currentIndex + Math.sign(targetIndex - currentIndex)
          )
        );

        activateStoryScene(refs.storyScroller.scenes[clampedIndex].id, true);
      }
    },
    {
      root: null,
      threshold: [0.25, 0.45, 0.7],
      rootMargin: "-12% 0px -26% 0px",
    }
  );

  steps.forEach((step) => refs.storyObserver.observe(step));
  activateStoryScene(refs.storyScroller?.activeSceneId || steps[0].dataset.scene, false);
}

function activateStoryScene(sceneId, animate = true) {
  if (!refs.storyScroller) {
    return;
  }

  const scene = refs.storyScroller.scenes.find((entry) => entry.id === sceneId);
  if (!scene) {
    return;
  }

  const shouldAnimate = animate && refs.storyScroller.activeSceneId !== scene.id;
  if (shouldAnimate) {
    refs.storySceneLockUntil = Date.now() + 900;
  }
  refs.storyScroller.activeSceneId = scene.id;
  const viewport = document.getElementById("story-viewport");
  const activeIndex = refs.storyScroller.scenes.findIndex(
    (entry) => entry.id === scene.id
  );

  viewport?.classList.toggle(
    "is-beyond-opening",
    scene.id !== refs.storyScroller.scenes[0].id
  );

  d3.select("#story-step-list")
    .selectAll(".story-step")
    .classed("active", (entry) => entry.id === scene.id);

  d3.select("#story-progress")
    .selectAll(".story-progress-step")
    .classed("seen", (_, index) => index <= activeIndex)
    .classed("active", (_, index) => index === activeIndex);

  if (shouldAnimate) {
    // Phase 1: exit old text
    exitStoryStageCopy();

    // Phase 2: after exit completes, swap content + reveal text
    window.clearTimeout(refs.storySwapTimer);
    refs.storySwapTimer = window.setTimeout(() => {
      viewport?.classList.toggle("chart-visible", scene.showChart);
      applyStoryStageCopy(scene);

      // Let the chart graphic arrive slightly after the text without shifting the text layout.
      window.clearTimeout(refs.storyChartDelayTimer);
      if (scene.showChart) {
        refs.storyChartDelayTimer = window.setTimeout(() => {
          renderStorySceneChart(scene, true);
        }, 400);
      } else {
        renderStorySceneChart(scene, false);
      }

      // Phase 3: stagger-reveal each anim-line
      revealStoryStageCopy();
    }, prefersReducedMotion ? 0 : 380);
  } else {
    // instant: no animation
    viewport?.classList.toggle("chart-visible", scene.showChart);
    applyStoryStageCopy(scene);
    revealStoryStageCopy(true);
    renderStorySceneChart(scene, false);
  }
}

function renderStorySceneChart(scene, animate) {
  const host = document.getElementById("story-stage-chart");
  if (!host) {
    return;
  }

  const drawScene = () => {
    d3.select(host).selectAll("*").remove();

    if (!scene.showChart || !scene.visual) {
      return;
    }

    if (scene.visual.type === "line") {
      renderStoryLineChart(host, scene.visual, animate);
      return;
    }

    if (scene.visual.type === "matrix") {
      renderStoryMatrixChart(host, scene.visual, animate);
      return;
    }

    if (scene.visual.type === "category-bars") {
      renderStoryCategoryBars(host, scene.visual, animate);
      return;
    }

    if (scene.visual.type === "constellation") {
      renderStoryConstellation(host, animate);
      return;
    }

    if (scene.visual.type === "category-currents") {
      renderStoryCategoryCurrents(host, animate);
    }
  };

  window.clearTimeout(refs.storyChartTimer);
  if (!animate || prefersReducedMotion) {
    host.classList.remove("is-swapping");
    drawScene();
    return;
  }

  host.classList.add("is-swapping");
  refs.storyChartTimer = window.setTimeout(() => {
    drawScene();
    host.classList.remove("is-swapping");
  }, 170);
}

function renderStoryLineChart(host, visual, animate) {
  const range = clampSceneRange(visual.range || model.fullRange);
  const days = getDaysWithinRange(range);
  const width = Math.max(host.getBoundingClientRect().width, 320);
  const height = 330;
  const margin = { top: 24, right: 28, bottom: 40, left: 28 };
  const plotHeight = height - margin.top - margin.bottom;
  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);
  const defs = svg.append("defs");
  const gradientId = `storyStageGradient-${visual.type}`;
  const clipId = `storyStageClip-${visual.type}`;

  defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("x2", "100%")
    .attr("y1", "0%")
    .attr("y2", "0%")
    .call((gradient) => {
      gradient.append("stop").attr("offset", "0%").attr("stop-color", "#ff6b4a");
      gradient.append("stop").attr("offset", "54%").attr("stop-color", "#f4a261");
      gradient.append("stop").attr("offset", "100%").attr("stop-color", "#3d74ff");
    });

  const clipRect = defs
    .append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", animate && !prefersReducedMotion ? 0 : width - margin.left - margin.right)
    .attr("height", plotHeight);

  const x = d3.scaleTime().domain(range).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 10]).range([height - margin.bottom, margin.top]);

  const area = d3
    .area()
    .x((day) => x(day.date))
    .y0(height - margin.bottom)
    .y1((day) => y(day.total))
    .curve(d3.curveMonotoneX);

  const line = d3
    .line()
    .x((day) => x(day.date))
    .y((day) => y(day.total))
    .curve(d3.curveMonotoneX);

  svg
    .append("g")
    .selectAll("line")
    .data([0, 2, 4, 6, 8, 10])
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (tick) => y(tick))
    .attr("y2", (tick) => y(tick));

  svg
    .append("g")
    .selectAll("text")
    .data([0, 5, 10])
    .join("text")
    .attr("class", "chart-label")
    .attr("x", margin.left)
    .attr("y", (tick) => y(tick) - 8)
    .text((tick) => `${tick}`);

  if (visual.band) {
    const bandRange = clampSceneRange(visual.band);
    svg
      .append("rect")
      .attr("class", "story-range-band")
      .attr("x", x(bandRange[0]))
      .attr("y", margin.top)
      .attr("width", Math.max(2, x(bandRange[1]) - x(bandRange[0])))
      .attr("height", plotHeight)
      .attr("rx", 18);
  }

  const plot = svg.append("g").attr("clip-path", `url(#${clipId})`);

  plot
    .append("path")
    .datum(days)
    .attr("class", "story-focus-area")
    .attr("fill", `url(#${gradientId})`)
    .attr("d", area);

  plot
    .append("path")
    .datum(days)
    .attr("class", "story-focus-line")
    .attr("d", line);

  const tickDates =
    days.length > 14
      ? x.ticks(4)
      : days
          .filter(
            (_, index) =>
              index === 0 ||
              index === days.length - 1 ||
              index % Math.max(1, Math.ceil(days.length / 4)) === 0
          )
          .map((day) => day.date);

  svg
    .append("g")
    .selectAll("text")
    .data(tickDates)
    .join("text")
    .attr("class", "tick-label")
    .attr("x", (tick) => x(tick))
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text((tick) => formatShortDate(tick));

  const pointGroups = svg
    .append("g")
    .selectAll(".story-point")
    .data(visual.points || [], (point) => point.label)
    .join("g")
    .attr("class", "story-point")
    .attr(
      "transform",
      (point) => `translate(${x(point.day.date)},${y(point.day.total)})`
    )
    .attr("opacity", animate && !prefersReducedMotion ? 0 : 1);

  pointGroups
    .append("line")
    .attr("class", "story-point-stem")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", 0)
    .attr("y2", (point) => (point.dy >= 0 ? point.dy - 10 : point.dy + 8));

  pointGroups
    .append("circle")
    .attr("class", "story-point-dot")
    .attr("r", 5);

  pointGroups
    .append("text")
    .attr("class", "story-point-label")
    .attr("text-anchor", (point) => point.align || "start")
    .attr("x", (point) => point.dx || 0)
    .attr("y", (point) => point.dy || -16)
    .text((point) => point.label);

  if (animate && !prefersReducedMotion) {
    clipRect
      .transition()
      .duration(760)
      .ease(d3.easeCubicOut)
      .attr("width", width - margin.left - margin.right);

    pointGroups
      .transition()
      .delay(240)
      .duration(420)
      .ease(d3.easeCubicOut)
      .attr("opacity", 1);
  }
}

function renderStoryMatrixChart(host, visual, animate) {
  const days = getDaysWithinRange(visual.range);
  const habits = model.habits;
  const containerWidth = Math.max(host.getBoundingClientRect().width, 460);
  const margin = { top: 54, right: 18, bottom: 34, left: 132 };
  const cellSize = Math.max(
    18,
    Math.min(34, Math.floor((containerWidth - margin.left - margin.right) / days.length))
  );
  const width = margin.left + margin.right + days.length * cellSize;
  const height = margin.top + margin.bottom + habits.length * cellSize;
  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3
    .scaleBand()
    .domain(days.map((day) => day.dateKey))
    .range([margin.left, width - margin.right])
    .paddingInner(0.12);

  const y = d3
    .scaleBand()
    .domain(habits.map((habit) => habit.key))
    .range([margin.top, height - margin.bottom])
    .paddingInner(0.14);

  [
    {
      dateKey: visual.focusDateKey,
      label: visual.focusLabel,
      className: "story-column-focus",
    },
    {
      dateKey: visual.secondaryDateKey,
      label: visual.secondaryLabel,
      className: "story-column-secondary",
    },
  ]
    .filter((marker) => days.find((day) => day.dateKey === marker.dateKey))
    .forEach((marker) => {
      svg
        .append("rect")
        .attr("class", marker.className)
        .attr("x", x(marker.dateKey) - 4)
        .attr("y", margin.top - 12)
        .attr("width", x.bandwidth() + 8)
        .attr("height", height - margin.top - margin.bottom + 18)
        .attr("rx", 16);

      svg
        .append("text")
        .attr("class", "story-matrix-focus-label")
        .attr("x", x(marker.dateKey) + x.bandwidth() / 2)
        .attr("y", 18)
        .attr("text-anchor", "middle")
        .text(marker.label);
    });

  const matrixData = habits.flatMap((habit) =>
    days.map((day) => ({
      habit,
      day,
      done: day.completions[habit.key],
    }))
  );

  const cells = svg
    .append("g")
    .selectAll("rect")
    .data(matrixData)
    .join("rect")
    .attr("class", "story-matrix-cell")
    .attr("x", (entry) => x(entry.day.dateKey))
    .attr("y", (entry) => y(entry.habit.key))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", Math.min(8, x.bandwidth() / 2))
    .attr("fill", (entry) =>
      entry.done ? CATEGORY_COLORS[entry.habit.category] : "#ece2d1"
    )
    .attr("stroke", (entry) =>
      entry.day.dateKey === visual.focusDateKey ? "#17120d" : "rgba(23, 18, 13, 0.08)"
    )
    .attr("stroke-width", (entry) =>
      entry.day.dateKey === visual.focusDateKey ? 1.5 : 1
    )
    .attr("opacity", animate && !prefersReducedMotion ? 0 : 1);

  svg
    .append("g")
    .selectAll("text")
    .data(days)
    .join("text")
    .attr("class", "story-matrix-date")
    .attr("x", (day) => x(day.dateKey) + x.bandwidth() / 2)
    .attr("y", margin.top - 18)
    .attr("text-anchor", "middle")
    .text((day) => formatShortDate(day.date));

  svg
    .append("g")
    .selectAll("text")
    .data(habits)
    .join("text")
    .attr("class", "story-matrix-label")
    .attr("x", margin.left - 12)
    .attr("y", (habit) => y(habit.key) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end")
    .text((habit) => habit.label);

  if (animate && !prefersReducedMotion) {
    cells
      .transition()
      .delay((entry) => days.findIndex((day) => day.dateKey === entry.day.dateKey) * 34)
      .duration(260)
      .ease(d3.easeCubicOut)
      .attr("opacity", 1);
  }
}

function renderStoryCategoryBars(host, visual, animate) {
  const days = getDaysWithinRange(visual.range);
  const width = Math.max(host.getBoundingClientRect().width, 360);
  const height = 330;
  const margin = { top: 28, right: 22, bottom: 42, left: 22 };
  const data = days.map((day) => ({
    ...day,
    ...day.categoryCounts,
  }));
  const stack = d3.stack().keys(CATEGORY_LIST)(data);
  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3
    .scaleBand()
    .domain(days.map((day) => day.dateKey))
    .range([margin.left, width - margin.right])
    .padding(0.18);
  const y = d3.scaleLinear().domain([0, 10]).range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .selectAll("line")
    .data([0, 2, 4, 6, 8, 10])
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (tick) => y(tick))
    .attr("y2", (tick) => y(tick));

  svg
    .append("g")
    .selectAll("text")
    .data([0, 5, 10])
    .join("text")
    .attr("class", "chart-label")
    .attr("x", margin.left)
    .attr("y", (tick) => y(tick) - 8)
    .text((tick) => `${tick}`);

  if (days.find((day) => day.dateKey === visual.focusDateKey)) {
    svg
      .append("rect")
      .attr("class", "story-column-focus")
      .attr("x", x(visual.focusDateKey) - 5)
      .attr("y", margin.top - 8)
      .attr("width", x.bandwidth() + 10)
      .attr("height", height - margin.top - margin.bottom + 14)
      .attr("rx", 16);

    svg
      .append("text")
      .attr("class", "story-matrix-focus-label")
      .attr("x", x(visual.focusDateKey) + x.bandwidth() / 2)
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .text(visual.focusLabel);
  }

  stack.forEach((layer) => {
    svg
      .append("g")
      .selectAll("rect")
      .data(layer.map((segment) => ({ ...segment, key: layer.key })))
      .join("rect")
      .attr("class", "story-stack-segment")
      .attr("x", (segment) => x(segment.data.dateKey))
      .attr("width", x.bandwidth())
      .attr("rx", 10)
      .attr("fill", CATEGORY_COLORS[layer.key])
      .attr("opacity", 0.92)
      .attr("y", y(0))
      .attr("height", 0)
      .transition()
      .delay((segment) =>
        animate && !prefersReducedMotion
          ? days.findIndex((day) => day.dateKey === segment.data.dateKey) * 40
          : 0
      )
      .duration(animate && !prefersReducedMotion ? 420 : 0)
      .ease(d3.easeCubicOut)
      .attr("y", (segment) => y(segment[1]))
      .attr("height", (segment) => Math.max(0, y(segment[0]) - y(segment[1])));
  });

  const tickDays = days.filter(
    (_, index) =>
      index === 0 ||
      index === days.length - 1 ||
      index % Math.max(1, Math.ceil(days.length / 4)) === 0
  );

  svg
    .append("g")
    .selectAll("text")
    .data(tickDays)
    .join("text")
    .attr("class", "tick-label")
    .attr("x", (day) => x(day.dateKey) + x.bandwidth() / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text((day) => formatShortDate(day.date));
}

/* ═══════════════════════════════════════════════════════
   Story Constellation – simplified orbit graph
   ═══════════════════════════════════════════════════════ */
function renderStoryConstellation(host, animate) {
  const days = model.days;
  const habits = model.habits;
  const width = Math.max(host.getBoundingClientRect().width, 360);
  const height = 380;

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  // Build nodes
  const nodes = habits.map((habit, index) => {
    const angle = -Math.PI / 2 + (index / habits.length) * Math.PI * 2;
    const completed = days.filter((day) => day.completions[habit.key]).length;
    return {
      ...habit,
      angle,
      completed,
      rate: completed / days.length,
    };
  });

  // Build links
  const links = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      let together = 0;
      let either = 0;
      days.forEach((day) => {
        const aDone = day.completions[nodes[i].key];
        const bDone = day.completions[nodes[j].key];
        if (aDone || bDone) either += 1;
        if (aDone && bDone) together += 1;
      });
      if (!together || !either) continue;
      links.push({
        source: nodes[i].key,
        target: nodes[j].key,
        together,
        either,
        strength: together / either,
      });
    }
  }

  const sortedLinks = links.sort((a, b) => d3.descending(a.strength, b.strength));
  const maxStrength = d3.max(sortedLinks, (l) => l.strength) || 1;
  const widthScale = d3.scaleLinear().domain([0, maxStrength]).range([0.8, 6]);
  const opacityScale = d3.scaleLinear().domain([0, maxStrength]).range([0.06, 0.68]);

  // Layout
  const centerX = width / 2;
  const centerY = height / 2 + 8;
  const orbitRadius = Math.min(width, height) * 0.30;

  nodes.forEach((node) => {
    node.x = centerX + Math.cos(node.angle) * orbitRadius;
    node.y = centerY + Math.sin(node.angle) * orbitRadius;
    node.radius = 8 + node.rate * 13;
  });

  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));

  // Orbit ring
  svg
    .append("circle")
    .attr("cx", centerX)
    .attr("cy", centerY)
    .attr("r", orbitRadius + 18)
    .attr("fill", "rgba(255, 250, 241, 0.32)")
    .attr("stroke", "rgba(23, 18, 13, 0.06)");

  svg
    .append("text")
    .attr("class", "constellation-hint")
    .attr("x", centerX)
    .attr("y", centerY + 4)
    .attr("text-anchor", "middle")
    .text(`${days.length} days`);

  // Links
  const linkGroup = svg.append("g");
  linkGroup
    .selectAll("path")
    .data(sortedLinks)
    .join("path")
    .attr("class", "constellation-link")
    .attr("d", (link) => {
      const source = nodeByKey.get(link.source);
      const target = nodeByKey.get(link.target);
      return `M${source.x},${source.y} Q${centerX},${centerY} ${target.x},${target.y}`;
    })
    .attr("stroke", (link) => {
      const sKey = link.source;
      return CATEGORY_COLORS[HABIT_META[sKey].category] || "rgba(23,18,13,0.18)";
    })
    .attr("stroke-width", (link) => widthScale(link.strength))
    .attr("stroke-opacity", 0)
    .transition()
    .delay((_, i) => (animate && !prefersReducedMotion ? 300 + i * 30 : 0))
    .duration(animate && !prefersReducedMotion ? 500 : 0)
    .attr("stroke-opacity", (link) => opacityScale(link.strength));

  // Nodes
  const nodeGroups = svg
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "constellation-node")
    .attr("transform", (node) => `translate(${node.x},${node.y})`)
    .style("opacity", 0);

  nodeGroups
    .append("circle")
    .attr("r", (node) => node.radius)
    .attr("fill", (node) => CATEGORY_COLORS[node.category])
    .attr("stroke", "rgba(23, 18, 13, 0.12)")
    .attr("stroke-width", 1.3);

  nodeGroups
    .append("text")
    .attr("class", "constellation-label")
    .attr("x", (node) => Math.cos(node.angle) * (node.radius + 12))
    .attr("y", (node) => Math.sin(node.angle) * (node.radius + 12) + 4)
    .attr("text-anchor", (node) => {
      const dir = Math.cos(node.angle);
      if (dir > 0.22) return "start";
      if (dir < -0.22) return "end";
      return "middle";
    })
    .attr("font-weight", 500)
    .text((node) => node.label);

  // Animate nodes in
  nodeGroups
    .transition()
    .delay((_, i) => (animate && !prefersReducedMotion ? 100 + i * 60 : 0))
    .duration(animate && !prefersReducedMotion ? 400 : 0)
    .style("opacity", 1);
}

/* ═══════════════════════════════════════════════════════
   Story Category Currents – stacked area for full semester
   ═══════════════════════════════════════════════════════ */
function renderStoryCategoryCurrents(host, animate) {
  const days = model.days;
  const width = Math.max(host.getBoundingClientRect().width, 360);
  const height = 330;
  const margin = { top: 20, right: 18, bottom: 38, left: 22 };

  const data = days.map((day) => ({
    date: day.date,
    dateKey: day.dateKey,
    total: d3.sum(CATEGORY_LIST, (cat) => day.categoryCounts[cat]),
    ...Object.fromEntries(
      CATEGORY_LIST.map((cat) => [cat, day.categoryCounts[cat]])
    ),
  }));

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.dateKey))
    .range([margin.left, width - margin.right])
    .padding(0.08);

  const y = d3
    .scaleLinear()
    .domain([0, Math.max(1, d3.max(data, (d) => d.total))])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const stack = d3.stack().keys(CATEGORY_LIST)(data);
  const area = d3
    .area()
    .x((pt) => x(pt.data.dateKey) + x.bandwidth() / 2)
    .y0((pt) => y(pt[0]))
    .y1((pt) => y(pt[1]))
    .curve(d3.curveCatmullRom.alpha(0.6));

  // Grid
  svg
    .append("g")
    .selectAll("line")
    .data(y.ticks(4))
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (t) => y(t))
    .attr("y2", (t) => y(t));

  // Stacked area layers
  const dominantCat = model.storyStops.dominantCategory;
  svg
    .append("g")
    .selectAll("path")
    .data(stack)
    .join("path")
    .attr("class", "current-layer")
    .attr("d", area)
    .attr("fill", (layer) => CATEGORY_COLORS[layer.key])
    .attr("fill-opacity", (layer) => (layer.key === dominantCat ? 0.88 : 0.58))
    .attr("stroke", (layer) => d3.color(CATEGORY_COLORS[layer.key]).darker(0.4))
    .attr("stroke-width", (layer) => (layer.key === dominantCat ? 2.2 : 1.1))
    .style("opacity", 0)
    .transition()
    .delay((_, i) => (animate && !prefersReducedMotion ? 200 + i * 120 : 0))
    .duration(animate && !prefersReducedMotion ? 600 : 0)
    .ease(d3.easeCubicOut)
    .style("opacity", 1);

  // Axis ticks
  const tickDays = data.filter(
    (_, i) => i === 0 || i === data.length - 1 || data[i].date.getDate() === 1
  );
  svg
    .append("g")
    .selectAll("text")
    .data(tickDays)
    .join("text")
    .attr("class", "current-axis-label")
    .attr("x", (d) => x(d.dateKey) + x.bandwidth() / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .text((d) => formatShortDate(d.date));

  // Legend
  const legendGroup = svg.append("g")
    .attr("transform", `translate(${width - margin.right}, ${margin.top})`);

  CATEGORY_LIST.forEach((cat, i) => {
    const g = legendGroup.append("g")
      .attr("transform", `translate(0, ${i * 18})`);
    g.append("rect")
      .attr("x", -60)
      .attr("y", -6)
      .attr("width", 10)
      .attr("height", 10)
      .attr("rx", 3)
      .attr("fill", CATEGORY_COLORS[cat]);
    g.append("text")
      .attr("class", "chart-label")
      .attr("x", -46)
      .attr("y", 3)
      .text(cat);
  });
}
/**
 * Exit current text lines (slide up + fade out)
 */
function exitStoryStageCopy() {
  const lines = document.querySelectorAll("#story-stage-copy .anim-line");
  lines.forEach((el) => {
    el.classList.remove("visible");
    el.classList.add("exit");
  });
}

/**
 * Swap in new scene content (hidden until revealStoryStageCopy is called)
 */
function applyStoryStageCopy(scene) {
  const wrapper = document.getElementById("story-stage-copy");
  const kicker = document.getElementById("story-stage-kicker");
  const title = document.getElementById("story-stage-title");
  const subtitle = document.getElementById("story-stage-subtitle");
  const copy = document.getElementById("story-stage-text");

  if (!wrapper || !kicker || !title || !subtitle || !copy) {
    return;
  }

  wrapper.dataset.sceneTone = scene.tone || "narrative";

  // Set content
  kicker.textContent = scene.kicker;
  title.textContent = scene.title;
  subtitle.textContent = scene.subtitle;
  copy.textContent = scene.copy;

  kicker.hidden = !scene.kicker;
  subtitle.hidden = !scene.subtitle;
  copy.hidden = !scene.copy;

  // Wrap each visible element in anim-line span state
  [kicker, title, subtitle, copy].forEach((el) => {
    el.classList.add("anim-line");
    el.classList.remove("visible", "exit");
  });
}

/**
 * Stagger-reveal .anim-line elements
 */
function revealStoryStageCopy(instant = false) {
  const lines = Array.from(
    document.querySelectorAll("#story-stage-copy .anim-line")
  ).filter((el) => !el.hidden);

  if (instant || prefersReducedMotion) {
    lines.forEach((el) => {
      el.classList.add("visible");
      el.classList.remove("exit");
    });
    return;
  }

  lines.forEach((el, i) => {
    window.setTimeout(() => {
      el.classList.remove("exit");
      el.classList.add("visible");
    }, i * 180);
  });
}

function renderHeroStats() {
  const stats = [
    {
      label: "Tracked days",
      value: `${model.globalStats.totalDays}`,
      copy: "Every day from Jan 1 to Mar 17 is represented in the matrix.",
    },
    {
      label: "Average score",
      value: `${formatDecimal(model.globalStats.averageScore)}/10`,
      copy: "Each day records how many of the ten habits were completed.",
    },
    {
      label: "Perfect days",
      value: `${model.globalStats.perfectDays.length}`,
      copy: "Only two dates hit all ten habits, which makes them useful story anchors.",
    },
    {
      label: "Detailed diary days",
      value: `${model.globalStats.detailedDays}`,
      copy: "January includes a second layer with ordered activities across the day.",
    },
  ];

  const cards = d3
    .select("#hero-stats")
    .selectAll(".hero-stat")
    .data(stats)
    .join("article")
    .attr("class", "hero-stat");

  cards
    .append("p")
    .attr("class", "section-kicker")
    .text((d) => d.label);

  cards
    .append("div")
    .attr("class", "hero-stat-value")
    .text((d) => d.value);

  cards
    .append("p")
    .attr("class", "hero-stat-label")
    .text((d) => d.copy);
}

function renderRangeControls() {
  const rangeButtons = [
    { id: "all", label: "All 76 days", range: model.fullRange },
    ...model.monthlyWindows,
  ];

  const controls = d3
    .select("#range-controls")
    .selectAll("button")
    .data(rangeButtons)
    .join("button")
    .attr("class", "chip")
    .attr("type", "button")
    .attr("aria-pressed", (d) => String(state.activeRangePreset === d.id))
    .classed("active", (d) => state.activeRangePreset === d.id)
    .text((d) => d.label)
    .on("click", (_, d) => {
      state.activeRangePreset = d.id;
      state.activeStoryPreset = null;
      moveBrushToRange(d.range);
    });
}

function renderStoryControls() {
  const stories = getStoryMoments().filter((story) => story.showInControls);

  d3.select("#story-controls")
    .selectAll("button")
    .data(stories)
    .join("button")
    .attr("class", "chip")
    .attr("type", "button")
    .attr("aria-pressed", (d) => String(state.activeStoryPreset === d.id))
    .classed("active", (d) => state.activeStoryPreset === d.id)
    .text((d) => d.label)
    .on("click", (_, d) => {
      state.activeStoryPreset = d.id;
      state.activeRangePreset = null;
      state.selectedDateKey = d.day.dateKey;
      state.selectedHabitKey = d.habitKey;
      ensureHabitCategoryVisible(d.habitKey);
      moveBrushToRange(d.range);
    });
}

function renderCategoryControls() {
  d3.select("#category-controls")
    .selectAll("button")
    .data(CATEGORY_LIST)
    .join("button")
    .attr("class", "chip category-chip")
    .style("--chip-color", (d) => CATEGORY_COLORS[d])
    .attr("type", "button")
    .attr("aria-pressed", (d) => String(state.activeCategories.has(d)))
    .classed("active", (d) => state.activeCategories.has(d))
    .text((d) => d)
    .on("click", (_, category) => {
      toggleCategory(category);
    });
}

function renderPlaybackControls() {
  d3.select("#speed-controls")
    .selectAll("button")
    .data(PLAYBACK_SPEEDS)
    .join("button")
    .attr("class", "chip")
    .attr("type", "button")
    .classed("active", (speed) => speed.id === state.playbackSpeed)
    .text((speed) => speed.label)
    .on("click", (_, speed) => {
      state.playbackSpeed = speed.id;
      if (state.isPlaying) {
        startPlayback(true);
      }
      updatePlaybackUI();
    });

  d3.select("#play-toggle").on("click", () => {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  d3.select("#play-restart").on("click", () => {
    restartPlayback();
  });

  d3.select("#playback-slider").on("input", (event) => {
    const nextDay = model.days[Number(event.target.value)];
    if (!nextDay) {
      return;
    }

    stopPlayback();
    state.cumulativeMode = true;
    state.lastStoryPauseKey = null;
    state.selectedDateKey = nextDay.dateKey;
    state.activeStoryPreset = null;
    syncCumulativeWindow();
    refreshPanels();
  });

  updatePlaybackUI();
}

function renderLegend() {
  const items = [
    { label: "Selected focus", swatch: "#17120d" },
    { label: "Missed", swatch: "#efe4cf" },
    ...Object.entries(CATEGORY_COLORS).map(([label, swatch]) => ({
      label,
      swatch,
    })),
  ];

  d3.select("#matrix-legend")
    .selectAll(".legend-pill")
    .data(items)
    .join("div")
    .attr("class", "legend-pill")
    .html(
      (d) =>
        `<span class="legend-swatch" style="--swatch:${d.swatch}"></span>${d.label}`
    );
}

function renderCategoryLegend() {
  d3.select("#category-legend")
    .selectAll(".legend-pill")
    .data(
      Object.entries(CATEGORY_COLORS).map(([label, swatch]) => ({
        label,
        swatch,
      }))
    )
    .join("div")
    .attr("class", "legend-pill")
    .html(
      (d) =>
        `<span class="legend-swatch" style="--swatch:${d.swatch}"></span>${d.label}`
    );
}

function renderReadingPanel() {
  const items = [
    {
      title: "Start with the intro, then open the atlas",
      copy:
        "The first screen gives the short narrative of Thomas's semester. The atlas below opens the full habit record for closer inspection.",
    },
    {
      title: "Read the matrix first",
      copy:
        "Rows are habits and columns are days. Filled squares mean completed, so stacked gaps usually signal pressure rather than one forgotten task.",
    },
  ];

  d3.select("#global-insights")
    .selectAll(".reading-item")
    .data(items)
    .join("article")
    .attr("class", "reading-item")
    .html(
      (d) =>
        `<p class="reading-title">${d.title}</p><p class="reading-copy">${d.copy}</p>`
    );
}

function renderOverview() {
  const container = document.getElementById("overview-chart");
  const width = Math.max(container.getBoundingClientRect().width, 320);
  const height = 260;
  const margin = { top: 20, right: 16, bottom: 36, left: 18 };

  d3.select(container).selectAll("*").remove();

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const defs = svg.append("defs");
  const clipId = "overviewClip";
  const clipRect = defs
    .append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", margin.left)
    .attr("y", margin.top)
    .attr("width", 0)
    .attr("height", height - margin.top - margin.bottom);

  const gradient = defs
    .append("linearGradient")
    .attr("id", "overviewGradient")
    .attr("x1", "0%")
    .attr("x2", "100%")
    .attr("y1", "0%")
    .attr("y2", "0%");

  gradient.append("stop").attr("offset", "0%").attr("stop-color", "#ff6b4a");
  gradient.append("stop").attr("offset", "50%").attr("stop-color", "#f4a261");
  gradient.append("stop").attr("offset", "100%").attr("stop-color", "#3d74ff");

  const x = d3
    .scaleTime()
    .domain(model.fullRange)
    .range([margin.left, width - margin.right]);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(model.days, (d) => d.total)])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const area = d3
    .area()
    .x((d) => x(d.date))
    .y0(height - margin.bottom)
    .y1((d) => y(d.total))
    .curve(d3.curveMonotoneX);

  const line = d3
    .line()
    .x((d) => x(d.date))
    .y((d) => y(d.total))
    .curve(d3.curveMonotoneX);

  svg
    .append("g")
    .selectAll("line")
    .data(y.ticks(4))
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));

  const plotGroup = svg.append("g").attr("clip-path", `url(#${clipId})`);

  const areaPath = plotGroup
    .append("path")
    .datum(model.days)
    .attr("class", "overview-area")
    .attr("d", area);

  const linePath = plotGroup
    .append("path")
    .datum(model.days)
    .attr("class", "overview-line")
    .attr("d", line);

  const brush = d3
    .brushX()
    .extent([
      [margin.left, margin.top],
      [width - margin.right, height - margin.bottom],
    ])
    .on("brush end", (event) => {
      if (!event.selection) {
        return;
      }
      const [start, end] = event.selection.map(x.invert);
      state.brushedRange = [start, end];
      if (event.sourceEvent) {
        stopPlayback();
        state.cumulativeMode = false;
        state.activeRangePreset = null;
        state.activeStoryPreset = null;
      }
      updateControlStates();
      refreshPanels();
    });

  const brushGroup = svg.append("g").attr("class", "brush").call(brush);
  brushGroup.call(brush.move, model.fullRange.map(x));

  const dots = plotGroup
    .append("g")
    .selectAll("circle")
    .data(model.days)
    .join("circle")
    .attr("class", "overview-dot")
    .attr("cx", (d) => x(d.date))
    .attr("cy", (d) => y(d.total))
    .attr("r", 4)
    .on("mouseenter", (event, d) => {
      showTooltip(
        event,
        `<strong>${formatLongDate(d.date)}</strong><br>${d.total} of 10 habits completed`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      state.selectedDateKey = d.dateKey;
      state.activeStoryPreset = null;
      state.activeRangePreset = null;

      if (!getVisibleDays().find((day) => day.dateKey === d.dateKey)) {
        moveBrushToRange([
          d3.timeDay.offset(d.date, -3),
          d3.timeDay.offset(d.date, 3),
        ]);
      } else {
        refreshPanels();
      }
    });

  svg
    .append("g")
    .selectAll("g")
    .data(getStoryMoments())
    .join("g")
    .attr("transform", (story, index) => {
      const xPos = x(story.day.date);
      const yPos = y(story.day.total);
      const lift = 24 + (index % 2) * 24;
      return `translate(${xPos},${yPos - lift})`;
    })
    .each(function (story) {
      const group = d3.select(this);
      group
        .append("line")
        .attr("class", "annotation-line")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", 10)
        .attr("y2", 26);

      group
        .append("text")
        .attr("class", "annotation-label")
        .attr("text-anchor", "middle")
        .text(story.shortLabel);

      group
        .append("circle")
        .attr("cx", 0)
        .attr("cy", 26)
        .attr("r", 3.5)
        .attr("fill", "#17120d");
    })
    .on("mouseenter", (event, story) => {
      showTooltip(
        event,
        `<strong>${story.label}</strong><br>${story.summary}<br>${formatLongDate(
          story.day.date
        )}`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, story) => {
      state.activeStoryPreset = story.showInControls ? story.id : null;
      state.activeRangePreset = null;
      state.selectedDateKey = story.day.dateKey;
      state.selectedHabitKey = story.habitKey;
      ensureHabitCategoryVisible(story.habitKey);
      moveBrushToRange(story.range);
    });

  svg
    .append("g")
    .selectAll("text")
    .data(x.ticks(d3.timeWeek.every(2)))
    .join("text")
    .attr("class", "tick-label")
    .attr("x", (d) => x(d))
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .text((d) => formatShortDate(d));

  const selectedMarker = svg.append("g");

  refs.overview = {
    x,
    y,
    brush,
    brushGroup,
    selectedMarker,
    dots,
    areaPath,
    linePath,
    clipRect,
    plotTop: margin.top,
    plotBottom: height - margin.bottom,
    plotLeft: margin.left,
    plotRight: width - margin.right,
  };
  updateOverviewSelection();
  updateOverviewMask(true);
}

function refreshPanels() {
  if (state.cumulativeMode && state.selectedDateKey) {
    syncCumulativeWindow();
  }

  const visibleDays = getVisibleDays();
  const visibleHabits = getVisibleHabits();

  if (!visibleHabits.length || !visibleDays.length) {
    return;
  }

  if (!visibleHabits.find((habit) => habit.key === state.selectedHabitKey)) {
    state.selectedHabitKey = visibleHabits[0].key;
  }

  if (!visibleDays.find((day) => day.dateKey === state.selectedDateKey)) {
    state.selectedDateKey = visibleDays[0].dateKey;
  }

  updateControlStates();
  updatePlaybackUI();
  updateOverviewSelection();
  updateOverviewMask(state.isPlaying || state.cumulativeMode);
  updateContextCopy(visibleDays, visibleHabits);
  renderDetailPanel(visibleDays);
  renderCategoryCurrents(visibleDays);
  renderConstellation(visibleDays, visibleHabits);
  renderMatrix(visibleDays, visibleHabits);
  renderSequenceView();
}

function renderDetailPanel(visibleDays) {
  const selectedDay = model.dayMap.get(state.selectedDateKey);
  const selectedHabitMeta = HABIT_META[state.selectedHabitKey];
  const completedDays = visibleDays.filter(
    (day) => day.completions[state.selectedHabitKey]
  );
  const windowStats = computeHabitStats(visibleDays, state.selectedHabitKey);
  const overallStats = model.overallStats[state.selectedHabitKey];

  d3.select("#selection-summary").html(`
    <p>
      <strong>${selectedHabitMeta.label}</strong> appears on
      <strong>${completedDays.length}</strong> of
      <strong>${visibleDays.length}</strong> visible days. The selected day is
      <strong>${formatLongDate(selectedDay.date)}</strong>, with
      <strong>${selectedDay.total}</strong> of 10 habits completed.
    </p>
  `);

  const statCards = [
    {
      label: "Completion rate",
      value: formatPercent(completedDays.length / visibleDays.length),
      note: "Inside the current brushed window.",
    },
    {
      label: "Longest streak",
      value: `${windowStats.longestStreak} days`,
      note: `Overall longest streak: ${overallStats.longestStreak} days.`,
    },
    {
      label: "Current streak",
      value: `${overallStats.currentStreak} days`,
      note: "Measured from the end of the full Jan-Mar season.",
    },
    {
      label: "Selected day score",
      value: `${selectedDay.total}/10`,
      note: `${selectedHabitMeta.label} was ${
        selectedDay.completions[state.selectedHabitKey] ? "completed" : "missed"
      } on that day.`,
    },
  ];

  const cards = d3
    .select("#stat-grid")
    .selectAll(".stat-card")
    .data(statCards)
    .join("article")
    .attr("class", "stat-card");

  cards
    .html(
      (d) =>
        `<p class="stat-label">${d.label}</p><div class="stat-value">${d.value}</div><p class="stat-note">${d.note}</p>`
    );
}

function renderInsightRail(visibleDays, visibleHabits) {
  const selectedDay = model.dayMap.get(state.selectedDateKey);
  const bestDay = d3.greatest(visibleDays, (day) => day.total);
  const lowestDay = d3.least(visibleDays, (day) => day.total);
  const strongestPair = getStrongestPair(visibleDays, visibleHabits);
  const dominantCategory = d3.greatest(
    CATEGORY_LIST.filter((category) => state.activeCategories.has(category)),
    (category) => d3.mean(visibleDays, (day) => day.categoryCounts[category])
  );
  const storyMoment = getStoryMoments().find(
    (story) => story.day.dateKey === state.selectedDateKey
  );

  const cards = [
    storyMoment
      ? {
          kicker: "Narrative Moment",
          title: storyMoment.label,
          copy: `${storyMoment.summary} The selected day is ${formatLongDate(
            storyMoment.day.date
          )}.`,
        }
      : {
          kicker: "Window Signal",
          title: `${bestDay.total}/10 to ${lowestDay.total}/10`,
          copy: `This window peaks on ${formatShortDate(
            bestDay.date
          )} and bottoms out on ${formatShortDate(lowestDay.date)}.`,
        },
    strongestPair
      ? {
          kicker: "Strongest Pair",
          title: `${HABIT_META[strongestPair.source].label} + ${
            HABIT_META[strongestPair.target].label
          }`,
          copy: `They co-occur on ${strongestPair.together} days with a ${formatPercent(
            strongestPair.strength
          )} overlap score in this view.`,
        }
      : {
          kicker: "Strongest Pair",
          title: "Sparse window",
          copy: "Widen the time range or turn more categories on to reveal stronger pairings.",
        },
    {
      kicker: "Selected Focus",
      title: `${HABIT_META[state.selectedHabitKey].label} on ${formatShortDate(
        selectedDay.date
      )}`,
      copy: `${dominantCategory} dominates this window, and the selected day lands at ${selectedDay.total}/10 habits completed.`,
    },
  ];

  d3.select("#insight-cards")
    .selectAll(".insight-card")
    .data(cards)
    .join("article")
    .attr("class", "panel insight-card")
    .html(
      (card) =>
        `<p class="section-kicker">${card.kicker}</p><p class="insight-title">${card.title}</p><p class="insight-copy">${card.copy}</p>`
    );
}

function renderMonthBars() {
  const selectedHabitMeta = HABIT_META[state.selectedHabitKey];
  const monthly = MONTH_NAMES.map((monthName) => {
    const monthDays = model.days.filter((day) => day.month === monthName);
    const completed = monthDays.filter((day) => day.completions[state.selectedHabitKey]).length;
    return {
      month: monthName,
      rate: completed / monthDays.length,
      completed,
      total: monthDays.length,
    };
  });

  const bestMonth = monthly.reduce((best, current) =>
    current.rate > best.rate ? current : best
  );

  d3.select("#month-caption").text(
    `${selectedHabitMeta.label} peaks in ${bestMonth.month} (${formatPercent(
      bestMonth.rate
    )}).`
  );

  const container = document.getElementById("month-bars");
  const width = Math.max(container.getBoundingClientRect().width, 240);
  const height = 180;
  const margin = { top: 6, right: 42, bottom: 10, left: 88 };

  d3.select(container).selectAll("*").remove();

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
  const y = d3
    .scaleBand()
    .domain(monthly.map((d) => d.month))
    .range([margin.top, height - margin.bottom])
    .padding(0.32);

  svg
    .append("g")
    .selectAll("rect")
    .data(monthly)
    .join("rect")
    .attr("x", margin.left)
    .attr("y", (d) => y(d.month))
    .attr("width", (d) => x(d.rate) - margin.left)
    .attr("height", y.bandwidth())
    .attr("rx", 12)
    .attr("fill", CATEGORY_COLORS[selectedHabitMeta.category]);

  svg
    .append("g")
    .selectAll("text.label")
    .data(monthly)
    .join("text")
    .attr("class", "month-bar-label")
    .attr("x", margin.left - 10)
    .attr("y", (d) => y(d.month) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end")
    .text((d) => d.month);

  svg
    .append("g")
    .selectAll("text.value")
    .data(monthly)
    .join("text")
    .attr("class", "month-bar-value")
    .attr("x", (d) => x(d.rate) + 8)
    .attr("y", (d) => y(d.month) + y.bandwidth() / 2 + 4)
    .text((d) => `${formatPercent(d.rate)} (${d.completed}/${d.total})`);
}

function renderConstellation(visibleDays, visibleHabits) {
  const container = document.getElementById("constellation-chart");
  if (!container) {
    return;
  }
  const width = Math.max(container.getBoundingClientRect().width, 320);
  const height = 390;

  d3.select(container).selectAll("*").remove();

  if (visibleHabits.length < 2) {
    d3.select("#constellation-copy").text(
      "Keep at least two habits visible to map their co-completion links."
    );
    renderEmptyState(
      container,
      "This view needs at least two visible habits before a relationship map can form."
    );
    return;
  }

  const nodes = visibleHabits.map((habit, index) => {
    const angle = -Math.PI / 2 + (index / visibleHabits.length) * Math.PI * 2;
    const completed = visibleDays.filter((day) => day.completions[habit.key]).length;
    return {
      ...habit,
      angle,
      completed,
      rate: completed / visibleDays.length,
    };
  });

  const links = [];
  for (let index = 0; index < nodes.length; index += 1) {
    for (let next = index + 1; next < nodes.length; next += 1) {
      const source = nodes[index];
      const target = nodes[next];
      let together = 0;
      let either = 0;

      visibleDays.forEach((day) => {
        const sourceDone = day.completions[source.key];
        const targetDone = day.completions[target.key];
        if (sourceDone || targetDone) {
          either += 1;
        }
        if (sourceDone && targetDone) {
          together += 1;
        }
      });

      if (!together || !either) {
        continue;
      }

      links.push({
        source: source.key,
        target: target.key,
        together,
        either,
        strength: together / either,
      });
    }
  }

  const sortedLinks = links.sort((a, b) => d3.descending(a.strength, b.strength));
  const selectedLinks = sortedLinks.filter(
    (link) =>
      link.source === state.selectedHabitKey || link.target === state.selectedHabitKey
  );
  const bestMatch = selectedLinks[0];

  if (bestMatch) {
    const partnerKey =
      bestMatch.source === state.selectedHabitKey ? bestMatch.target : bestMatch.source;
    d3.select("#constellation-copy").text(
      `${HABIT_META[state.selectedHabitKey].label} most strongly travels with ${
        HABIT_META[partnerKey].label
      } in this window (${formatPercent(bestMatch.strength)} overlap by union).`
    );
  } else {
    d3.select("#constellation-copy").text(
      "This window is too sparse to show strong habit pairings."
    );
  }

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const centerX = width / 2;
  const centerY = height / 2 + 16;
  const orbitRadius = Math.min(width, height) * 0.32;

  nodes.forEach((node) => {
    node.x = centerX + Math.cos(node.angle) * orbitRadius;
    node.y = centerY + Math.sin(node.angle) * orbitRadius;
    node.radius = 9 + node.rate * 14;
  });

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const maxStrength = d3.max(sortedLinks, (link) => link.strength) || 1;
  const widthScale = d3.scaleLinear().domain([0, maxStrength]).range([0.8, 6.2]);
  const opacityScale = d3.scaleLinear().domain([0, maxStrength]).range([0.08, 0.78]);

  svg
    .append("circle")
    .attr("cx", centerX)
    .attr("cy", centerY)
    .attr("r", orbitRadius + 18)
    .attr("fill", "rgba(255, 250, 241, 0.38)")
    .attr("stroke", "rgba(23, 18, 13, 0.08)");

  svg
    .append("text")
    .attr("class", "constellation-hint")
    .attr("x", centerX)
    .attr("y", centerY + 4)
    .attr("text-anchor", "middle")
    .text(`${visibleDays.length} days in view`);

  svg
    .append("g")
    .selectAll("path")
    .data(sortedLinks)
    .join("path")
    .attr("class", "constellation-link")
    .attr("d", (link) => {
      const source = nodeByKey.get(link.source);
      const target = nodeByKey.get(link.target);
      return `M${source.x},${source.y} Q${centerX},${centerY} ${target.x},${target.y}`;
    })
    .attr("stroke", (link) => {
      if (link.source === state.selectedHabitKey || link.target === state.selectedHabitKey) {
        const partnerKey =
          link.source === state.selectedHabitKey ? link.target : link.source;
        return CATEGORY_COLORS[HABIT_META[partnerKey].category];
      }
      return "rgba(23, 18, 13, 0.18)";
    })
    .attr("stroke-width", (link) => widthScale(link.strength))
    .attr("stroke-opacity", (link) => {
      if (link.source === state.selectedHabitKey || link.target === state.selectedHabitKey) {
        return Math.max(0.24, opacityScale(link.strength));
      }
      return 0.06;
    })
    .on("mouseenter", (event, link) => {
      showTooltip(
        event,
        `<strong>${HABIT_META[link.source].label}</strong> + <strong>${
          HABIT_META[link.target].label
        }</strong><br>Together on ${link.together} days<br>Relationship strength: ${formatPercent(
          link.strength
        )}`
      );
    })
    .on("mouseleave", hideTooltip);

  const nodeGroups = svg
    .append("g")
    .selectAll("g")
    .data(
      [...nodes].sort((left, right) =>
        d3.ascending(
          Number(left.key === state.selectedHabitKey),
          Number(right.key === state.selectedHabitKey)
        )
      )
    )
    .join("g")
    .attr("class", "constellation-node")
    .attr("transform", (node) => `translate(${node.x},${node.y})`)
    .on("mouseenter", (event, node) => {
      showTooltip(
        event,
        `<strong>${node.label}</strong><br>${node.completed} completed days<br>Completion rate: ${formatPercent(
          node.rate
        )}`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, node) => {
      state.selectedHabitKey = node.key;
      state.activeStoryPreset = null;
      refreshPanels();
    });

  nodeGroups
    .append("circle")
    .attr("r", (node) => (node.key === state.selectedHabitKey ? node.radius + 5 : 0))
    .attr("fill", (node) => CATEGORY_COLORS[node.category])
    .attr("fill-opacity", 0.18);

  nodeGroups
    .append("circle")
    .attr("r", (node) => node.radius)
    .attr("fill", (node) => CATEGORY_COLORS[node.category])
    .attr("stroke", (node) =>
      node.key === state.selectedHabitKey ? "#17120d" : "rgba(23, 18, 13, 0.12)"
    )
    .attr("stroke-width", (node) => (node.key === state.selectedHabitKey ? 2.4 : 1.3));

  nodeGroups
    .append("text")
    .attr("class", "constellation-label")
    .attr("x", (node) => Math.cos(node.angle) * (node.radius + 14))
    .attr("y", (node) => Math.sin(node.angle) * (node.radius + 14) + 4)
    .attr("text-anchor", (node) => {
      const direction = Math.cos(node.angle);
      if (direction > 0.22) {
        return "start";
      }
      if (direction < -0.22) {
        return "end";
      }
      return "middle";
    })
    .attr("font-weight", (node) => (node.key === state.selectedHabitKey ? 700 : 500))
    .text((node) => node.label);
}

function renderCategoryCurrents(visibleDays) {
  const container = document.getElementById("category-chart");
  const width = Math.max(container.getBoundingClientRect().width, 320);
  const height = 320;

  d3.select(container).selectAll("*").remove();

  const visibleCategories = CATEGORY_LIST.filter((category) =>
    state.activeCategories.has(category)
  );

  if (!visibleDays.length || !visibleCategories.length) {
    d3.select("#category-copy").text("No category data is visible right now.");
    renderEmptyState(
      container,
      "Turn at least one category back on to see how the workload shifts across the brushed window."
    );
    return;
  }

  const data = visibleDays.map((day) => ({
    date: day.date,
    dateKey: day.dateKey,
    total: d3.sum(visibleCategories, (category) => day.categoryCounts[category]),
    ...Object.fromEntries(
      visibleCategories.map((category) => [category, day.categoryCounts[category]])
    ),
  }));

  const dominantCategory = d3.greatest(
    visibleCategories,
    (category) => d3.mean(data, (day) => day[category])
  );
  const dominantAverage = d3.mean(data, (day) => day[dominantCategory]);

  d3.select("#category-copy").text(
    `Each stacked bar is one day: height shows total completed habits, and color shows which categories made up that day. ${dominantCategory} contributes the most on average (${formatDecimal(
      dominantAverage
    )} per day).`
  );

  const margin = { top: 20, right: 18, bottom: 34, left: 20 };
  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3
    .scaleBand()
    .domain(data.map((day) => day.dateKey))
    .range([margin.left, width - margin.right])
    .padding(0.08);

  const y = d3
    .scaleLinear()
    .domain([0, Math.max(1, d3.max(data, (day) => day.total))])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const stack = d3.stack().keys(visibleCategories)(data);

  svg
    .append("g")
    .selectAll("line")
    .data(y.ticks(4))
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (tick) => y(tick))
    .attr("y2", (tick) => y(tick));

  if (data.find((day) => day.dateKey === state.selectedDateKey)) {
    svg
      .append("rect")
      .attr("x", x(state.selectedDateKey) - 2)
      .attr("y", margin.top)
      .attr("width", x.bandwidth() + 4)
      .attr("height", height - margin.top - margin.bottom)
      .attr("rx", 14)
      .attr("fill", "rgba(23, 18, 13, 0.05)");
  }

  const selectedCategory = HABIT_META[state.selectedHabitKey].category;
  svg
    .append("g")
    .selectAll("g")
    .data(stack)
    .join("g")
    .selectAll("rect")
    .data((layer) =>
      layer.map((segment) => ({
        key: layer.key,
        dateKey: segment.data.dateKey,
        date: segment.data.date,
        values: segment,
      }))
    )
    .join("rect")
    .attr("class", "current-segment")
    .attr("x", (segment) => x(segment.dateKey))
    .attr("width", x.bandwidth())
    .attr("y", (segment) => y(segment.values[1]))
    .attr("height", (segment) => Math.max(0, y(segment.values[0]) - y(segment.values[1])))
    .attr("rx", 6)
    .attr("fill", (segment) => CATEGORY_COLORS[segment.key])
    .attr("fill-opacity", (segment) =>
      segment.key === selectedCategory ? 0.92 : 0.72
    )
    .attr("stroke", (segment) =>
      segment.key === selectedCategory
        ? d3.color(CATEGORY_COLORS[segment.key]).darker(0.45)
        : "rgba(255, 255, 255, 0.44)"
    )
    .attr("stroke-width", (segment) => (segment.key === selectedCategory ? 1.4 : 0.7));

  svg
    .append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("class", "current-slice")
    .attr("x", (day) => x(day.dateKey))
    .attr("y", margin.top)
    .attr("width", x.bandwidth())
    .attr("height", height - margin.top - margin.bottom)
    .attr("fill", "transparent")
    .on("mouseenter", (event, day) => {
      const breakdown = visibleCategories
        .map((category) => ({
          category,
          value: day[category],
        }))
        .sort((left, right) => d3.descending(left.value, right.value))
        .map(
          ({ category, value }) =>
            `${category}: ${value} completed`
        )
        .join("<br>");

      showTooltip(
        event,
        `<strong>${formatLongDate(day.date)}</strong><br>${breakdown}<br>Total: ${day.total}/10`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, day) => {
      state.selectedDateKey = day.dateKey;
      state.activeStoryPreset = null;
      refreshPanels();
    });

  const tickDays = data.filter(
    (day, index) =>
      index === 0 || index === data.length - 1 || day.date.getDay() === 1
  );

  svg
    .append("g")
    .selectAll("text")
    .data(tickDays)
    .join("text")
    .attr("class", "current-axis-label")
    .attr("x", (day) => x(day.dateKey) + x.bandwidth() / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .text((day) => formatShortDate(day.date));
}

function renderMatrix(visibleDays, visibleHabits) {
  const container = document.getElementById("matrix-chart");
  const minWidth = Math.max(container.getBoundingClientRect().width, 680);
  const cellSize = Math.max(11, Math.min(24, (minWidth - 220) / visibleDays.length));
  const width = 190 + visibleDays.length * cellSize + 28;
  const height = 64 + visibleHabits.length * cellSize + 44;
  const margin = { top: 54, right: 18, bottom: 30, left: 170 };

  d3.select(container).selectAll("*").remove();

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .style("width", `${width}px`);

  const x = d3
    .scaleBand()
    .domain(visibleDays.map((day) => day.dateKey))
    .range([margin.left, width - margin.right])
    .paddingInner(0.1);

  const y = d3
    .scaleBand()
    .domain(visibleHabits.map((habit) => habit.key))
    .range([margin.top, height - margin.bottom])
    .paddingInner(0.16);

  const selectedDateKey = state.selectedDateKey;
  const selectedHabitKey = state.selectedHabitKey;

  if (visibleDays.find((day) => day.dateKey === selectedDateKey)) {
    svg
      .append("rect")
      .attr("x", x(selectedDateKey) - 3)
      .attr("y", margin.top - 18)
      .attr("width", x.bandwidth() + 6)
      .attr("height", height - margin.top - margin.bottom + 24)
      .attr("rx", 18)
      .attr("fill", "rgba(23, 18, 13, 0.05)");
  }

  if (visibleHabits.find((habit) => habit.key === selectedHabitKey)) {
    svg
      .append("rect")
      .attr("x", margin.left - 8)
      .attr("y", y(selectedHabitKey) - 4)
      .attr("width", width - margin.left - margin.right + 16)
      .attr("height", y.bandwidth() + 8)
      .attr("rx", 16)
      .attr("fill", "rgba(23, 18, 13, 0.035)");
  }

  const matrixData = visibleHabits.flatMap((habit) =>
    visibleDays.map((day) => ({
      ...habit,
      date: day.date,
      dateKey: day.dateKey,
      done: day.completions[habit.key],
      dayTotal: day.total,
    }))
  );

  svg
    .append("g")
    .selectAll("rect")
    .data(matrixData)
    .join("rect")
    .attr("class", "matrix-cell")
    .attr("x", (d) => x(d.dateKey))
    .attr("y", (d) => y(d.key))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", Math.min(8, x.bandwidth() / 2))
    .attr("fill", (d) => (d.done ? CATEGORY_COLORS[d.category] : "#efe4cf"))
    .attr("opacity", (d) => (d.done ? 0.92 : 1))
    .attr("stroke", (d) => {
      if (d.dateKey === selectedDateKey && d.key === selectedHabitKey) {
        return "#17120d";
      }
      if (d.dateKey === selectedDateKey || d.key === selectedHabitKey) {
        return "rgba(23, 18, 13, 0.4)";
      }
      return "rgba(23, 18, 13, 0.08)";
    })
    .attr("stroke-width", (d) =>
      d.dateKey === selectedDateKey && d.key === selectedHabitKey ? 2.2 : 1
    )
    .on("mouseenter", (event, d) => {
      const status = d.done ? "Completed" : "Missed";
      showTooltip(
        event,
        `<strong>${formatLongDate(d.date)}</strong><br>${d.label}: ${status}<br>Day score: ${d.dayTotal}/10`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      state.selectedDateKey = d.dateKey;
      state.selectedHabitKey = d.key;
      state.activeStoryPreset = null;
      refreshPanels();
    });

  const tickDays = visibleDays.filter(
    (day, index) =>
      index === 0 ||
      index === visibleDays.length - 1 ||
      day.date.getDay() === 1
  );

  svg
    .append("g")
    .selectAll("text")
    .data(tickDays)
    .join("text")
    .attr("class", "matrix-date-label")
    .attr("x", (d) => x(d.dateKey) + x.bandwidth() / 2)
    .attr("y", margin.top - 12)
    .attr("text-anchor", "start")
    .attr("transform", (d) => `rotate(-55 ${x(d.dateKey) + x.bandwidth() / 2} ${margin.top - 12})`)
    .text((d) => formatShortDate(d.date));

  svg
    .append("g")
    .selectAll("text")
    .data(visibleHabits)
    .join("text")
    .attr("class", (d) =>
      d.key === selectedHabitKey ? "matrix-label" : "matrix-label muted"
    )
    .attr("x", margin.left - 14)
    .attr("y", (d) => y(d.key) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end")
    .text((d) => d.label)
    .on("mouseenter", (event, d) => {
      const stats = model.overallStats[d.key];
      showTooltip(
        event,
        `<strong>${d.label}</strong><br>${d.category}<br>${stats.completed} completed days<br>Longest streak: ${stats.longestStreak} days`
      );
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      state.selectedHabitKey = d.key;
      state.activeStoryPreset = null;
      refreshPanels();
    });
}

function renderSequenceView() {
  const container = d3.select("#sequence-view");
  container.selectAll("*").remove();

  const selectedDay = model.dayMap.get(state.selectedDateKey);
  const routines = model.routinesByDate.get(state.selectedDateKey);

  if (!routines) {
    container
      .append("div")
      .attr("class", "empty-state")
      .html(`
        <p>
          <strong>${formatLongDate(selectedDay.date)}</strong> is outside the detailed
          January diary window. The matrix still records which habits landed that
          day, but the time-ordered sequence only exists for Jan 1 to Jan 22.
        </p>
      `);
    return;
  }

  const countsByCategory = d3.rollups(
    routines,
    (values) => values.length,
    (d) => d.category
  ).sort((a, b) => d3.descending(a[1], b[1]));

  const header = container.append("div").attr("class", "sequence-header");
  const headerCopy = header.append("div");

  headerCopy
    .append("div")
    .attr("class", "sequence-date")
    .text(formatLongDate(selectedDay.date));

  headerCopy
    .append("p")
    .attr("class", "sequence-score")
    .text(`${selectedDay.total} of 10 habits completed on this day.`);

  const chips = header.append("div").attr("class", "sequence-chips");
  chips
    .selectAll(".legend-pill")
    .data(countsByCategory)
    .join("div")
    .attr("class", "legend-pill")
    .html(
      ([category, count]) =>
        `<span class="legend-swatch" style="--swatch:${CATEGORY_COLORS[category]}"></span>${category} x ${count}`
    );

  const blocks = TIME_ORDER.map((block) => ({
    block,
    entries: routines.filter((entry) => entry.timeBlock === block),
  }));

  const columns = container
    .append("div")
    .attr("class", "sequence-grid")
    .selectAll(".time-column")
    .data(blocks)
    .join("section")
    .attr("class", "time-column");

  columns
    .append("h4")
    .attr("class", "time-label")
    .text((d) => d.block);

  columns
    .append("div")
    .attr("class", "event-stack")
    .selectAll("button")
    .data((d) => d.entries)
    .join("button")
    .attr("class", "event-pill")
    .style("--accent", (d) => CATEGORY_COLORS[d.category])
    .style("animation-delay", (_, i) => `${i * 80}ms`)
    .attr("type", "button")
    .html((d) => {
      const meta = d.habitKey ? HABIT_META[d.habitKey] : null;
      return `
        <span class="event-title">${d.activity}</span>
        <span class="event-meta">${d.category}${meta ? ` / links to ${meta.label}` : ""}</span>
      `;
    })
    .on("click", (_, d) => {
      if (d.habitKey) {
        state.selectedHabitKey = d.habitKey;
        ensureHabitCategoryVisible(d.habitKey);
        refreshPanels();
      }
    });
}

function updateContextCopy(visibleDays, visibleHabits) {
  const start = visibleDays[0].date;
  const end = visibleDays[visibleDays.length - 1].date;
  const averageScore = d3.mean(visibleDays, (day) => day.total);
  const januaryVisible = visibleDays.some((day) => model.routinesByDate.has(day.dateKey));

  d3.select("#overview-caption").text(
    `${formatDateRange(start, end)}. The line shows total habits completed each day; brush it to change the time window. Average score: ${formatDecimal(
      averageScore
    )} / 10.`
  );

  d3.select("#matrix-context").text(
    `Showing ${visibleDays.length} days across ${visibleHabits.length} habits. Rows are habits, columns are days, and filled squares mean completed. ${
      januaryVisible
        ? "January days in this window unlock the routine capsule below."
        : "This window is outside the detailed January diary."
    }`
  );
}

function updateOverviewSelection() {
  if (!refs.overview) {
    return;
  }

  const selectedDay = model.dayMap.get(state.selectedDateKey);
  refs.overview.dots.classed(
    "selected",
    (d) => d.dateKey === state.selectedDateKey
  );

  refs.overview.selectedMarker.selectAll("*").remove();
  refs.overview.selectedMarker
    .append("line")
    .attr("x1", refs.overview.x(selectedDay.date))
    .attr("x2", refs.overview.x(selectedDay.date))
    .attr("y1", refs.overview.plotTop - 2)
    .attr("y2", refs.overview.plotBottom)
    .attr("stroke", "rgba(23, 18, 13, 0.22)")
    .attr("stroke-dasharray", "4 4");

  refs.overview.selectedMarker
    .append("text")
    .attr("class", "tick-label")
    .attr("x", refs.overview.x(selectedDay.date))
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .text(formatShortDate(selectedDay.date));
}

function updateOverviewMask(animated) {
  if (!refs.overview || !model) {
    return;
  }

  const selectedDay = model.dayMap.get(state.selectedDateKey) || model.days[0];
  const fullWidth = Math.max(0, refs.overview.plotRight - refs.overview.plotLeft);
  const targetWidth = state.cumulativeMode
    ? Math.max(0, refs.overview.x(selectedDay.date) - refs.overview.plotLeft)
    : fullWidth;

  const rect = refs.overview.clipRect
    .attr("x", refs.overview.plotLeft)
    .attr("y", refs.overview.plotTop)
    .attr("height", Math.max(0, refs.overview.plotBottom - refs.overview.plotTop));

  if (animated) {
    rect
      .transition()
      .duration(700)
      .ease(d3.easeCubicOut)
      .attr("width", targetWidth);
  } else {
    rect.interrupt().attr("width", targetWidth);
  }
}

function updateControlStates() {
  d3.select("#range-controls")
    .selectAll("button")
    .classed("active", (d) => d.id === state.activeRangePreset)
    .attr("aria-pressed", (d) => String(d.id === state.activeRangePreset));

  d3.select("#story-controls")
    .selectAll("button")
    .classed("active", (d) => d.id === state.activeStoryPreset)
    .attr("aria-pressed", (d) => String(d.id === state.activeStoryPreset));

  d3.select("#category-controls")
    .selectAll("button")
    .classed("active", (d) => state.activeCategories.has(d))
    .attr("aria-pressed", (d) => String(state.activeCategories.has(d)));
}

function updatePlaybackUI() {
  const currentIndex = model
    ? Math.max(
        0,
        model.days.findIndex((day) => day.dateKey === state.selectedDateKey)
      )
    : 0;
  const slider = document.getElementById("playback-slider");
  const toggleButton = document.getElementById("play-toggle");
  const restartButton = document.getElementById("play-restart");

  if (!slider || !toggleButton || !restartButton) {
    return;
  }

  slider.max = model ? Math.max(0, model.days.length - 1) : 0;
  slider.value = model ? currentIndex : 0;
  slider.disabled = !model || model.days.length <= 1;

  const selectedDay = model ? model.days[currentIndex] : null;
  const visibleDays = model ? getVisibleDays() : [];
  const atEnd = model ? currentIndex >= model.days.length - 1 : true;
  const storyMoment =
    model && selectedDay
      ? getStoryMoments().find((story) => story.day.dateKey === selectedDay.dateKey)
      : null;

  toggleButton.textContent = state.isPlaying
    ? "Pause"
    : atEnd && model && model.days.length > 1
      ? "Replay"
      : "Play";
  toggleButton.classList.toggle("active", state.isPlaying);
  restartButton.disabled = !model || !model.days.length;

  d3.select("#speed-controls")
    .selectAll("button")
    .classed("active", (speed) => speed.id === state.playbackSpeed);

  d3.select("#playback-window").text(
    selectedDay
      ? state.cumulativeMode || state.isPlaying
        ? `Story span: ${formatShortDate(model.days[0].date)} -> ${formatShortDate(
            selectedDay.date
          )}`
        : `Current window: ${formatDateRange(
            visibleDays[0].date,
            visibleDays[visibleDays.length - 1].date
          )}`
      : "No window"
  );
  d3.select("#playback-date").text(
    selectedDay ? formatLongDate(selectedDay.date) : ""
  );
  d3.select("#playback-copy").text(
    storyMoment && !state.isPlaying
      ? `${storyMoment.shortLabel}: ${storyMoment.summary}`
      : state.isPlaying
        ? "Charts are building cumulatively from Jan 1 forward and pausing on story beats."
        : state.cumulativeMode
          ? "Scrub or resume to keep growing the season from day 1."
          : "Press play to switch into cumulative story mode from day 1."
  );
}

function getPlaybackDelay() {
  return PLAYBACK_SPEEDS.find((speed) => speed.id === state.playbackSpeed).delay;
}

function startPlayback(restartOnly = false) {
  if (!model || model.days.length <= 1) {
    return;
  }

  let currentIndex = model.days.findIndex((day) => day.dateKey === state.selectedDateKey);
  if (!state.cumulativeMode) {
    state.selectedDateKey = model.days[0].dateKey;
    currentIndex = 0;
    state.lastStoryPauseKey = null;
  } else if (currentIndex === -1 || currentIndex >= model.days.length - 1) {
    state.selectedDateKey = model.days[0].dateKey;
    currentIndex = 0;
    state.lastStoryPauseKey = null;
  }

  state.cumulativeMode = true;
  syncCumulativeWindow();
  state.isPlaying = true;
  window.clearInterval(refs.playbackTimer);
  refs.playbackTimer = window.setInterval(stepPlayback, getPlaybackDelay());

  if (!restartOnly) {
    refreshPanels();
  } else {
    updatePlaybackUI();
  }
}

function stepPlayback() {
  if (!model || model.days.length <= 1) {
    stopPlayback();
    return;
  }

  const currentIndex = model.days.findIndex((day) => day.dateKey === state.selectedDateKey);

  if (currentIndex === -1 || currentIndex >= model.days.length - 1) {
    stopPlayback();
    return;
  }

  state.selectedDateKey = model.days[currentIndex + 1].dateKey;
  state.activeStoryPreset = null;
  syncCumulativeWindow();
  refreshPanels();

  const storyMoment = getStoryMoments().find(
    (story) => story.day.dateKey === state.selectedDateKey
  );
  if (storyMoment && state.lastStoryPauseKey !== storyMoment.id) {
    state.lastStoryPauseKey = storyMoment.id;
    stopPlayback();
  }
}

function stopPlayback() {
  state.isPlaying = false;
  window.clearInterval(refs.playbackTimer);
  refs.playbackTimer = null;
  updatePlaybackUI();
}

function restartPlayback() {
  if (!model || !model.days.length) {
    return;
  }

  state.cumulativeMode = true;
  state.selectedDateKey = model.days[0].dateKey;
  state.activeStoryPreset = null;
  state.lastStoryPauseKey = null;
  syncCumulativeWindow();

  if (state.isPlaying) {
    startPlayback();
  } else {
    refreshPanels();
  }
}

function moveBrushToRange(range) {
  stopPlayback();
  state.cumulativeMode = false;
  state.lastStoryPauseKey = null;
  const clampedRange = [
    new Date(
      Math.max(range[0].getTime(), model.fullRange[0].getTime())
    ),
    new Date(
      Math.min(range[1].getTime(), model.fullRange[1].getTime())
    ),
  ];

  if (!refs.overview) {
    state.brushedRange = clampedRange;
    refreshPanels();
    return;
  }

  state.brushedRange = clampedRange;
  refs.overview.brushGroup.call(
    refs.overview.brush.move,
    clampedRange.map(refs.overview.x)
  );
}

function toggleCategory(category) {
  stopPlayback();
  state.lastStoryPauseKey = null;
  const next = new Set(state.activeCategories);
  if (next.has(category) && next.size === 1) {
    return;
  }

  if (next.has(category)) {
    next.delete(category);
  } else {
    next.add(category);
  }

  state.activeCategories = next;

  const selectedCategory = HABIT_META[state.selectedHabitKey].category;
  if (!state.activeCategories.has(selectedCategory)) {
    const replacement = model.habits.find((habit) =>
      state.activeCategories.has(habit.category)
    );
    state.selectedHabitKey = replacement.key;
  }

  refreshPanels();
}

function ensureHabitCategoryVisible(habitKey) {
  state.activeCategories.add(HABIT_META[habitKey].category);
}

function syncCumulativeWindow() {
  const selectedDay = model.dayMap.get(state.selectedDateKey) || model.days[0];
  state.brushedRange = [model.fullRange[0], selectedDay.date];
}

function getVisibleDays() {
  const [rawStart, rawEnd] = state.brushedRange || model.fullRange;
  const start = d3.timeDay.floor(rawStart);
  const end = d3.timeDay.offset(d3.timeDay.floor(rawEnd), 1);
  return model.days.filter((day) => day.date >= start && day.date < end);
}

function getVisibleHabits() {
  return model.habits.filter((habit) => state.activeCategories.has(habit.category));
}

function getDaysWithinRange(range) {
  const [start, end] = clampSceneRange(range);
  return model.days.filter((day) => day.date >= start && day.date <= end);
}

function computeHabitStats(days, habitKey) {
  let completed = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let rolling = 0;

  days.forEach((day) => {
    if (day.completions[habitKey]) {
      completed += 1;
      rolling += 1;
      longestStreak = Math.max(longestStreak, rolling);
    } else {
      rolling = 0;
    }
  });

  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (!days[index].completions[habitKey]) {
      break;
    }
    currentStreak += 1;
  }

  return {
    completed,
    currentStreak,
    longestStreak,
  };
}

function getStrongestPair(days, habits) {
  if (days.length < 2 || habits.length < 2) {
    return null;
  }

  let bestPair = null;

  for (let sourceIndex = 0; sourceIndex < habits.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < habits.length; targetIndex += 1) {
      const source = habits[sourceIndex].key;
      const target = habits[targetIndex].key;

      let together = 0;
      let either = 0;

      days.forEach((day) => {
        const sourceDone = day.completions[source];
        const targetDone = day.completions[target];
        if (sourceDone || targetDone) {
          either += 1;
        }
        if (sourceDone && targetDone) {
          together += 1;
        }
      });

      if (either && together) {
        const strength = together / either;
        if (
          !bestPair ||
          strength > bestPair.strength ||
          (strength === bestPair.strength && together > bestPair.together)
        ) {
          bestPair = {
            source,
            target,
            together,
            either,
            strength,
          };
        }
      }
    }
  }

  return bestPair;
}

function renderEmptyState(container, message) {
  d3.select(container)
    .append("div")
    .attr("class", "empty-state")
    .html(`<p>${message}</p>`);
}

function showTooltip(event, html) {
  refs.tooltip
    .html(html)
    .style("left", `${event.clientX + 16}px`)
    .style("top", `${event.clientY + 16}px`)
    .classed("visible", true);
}

function hideTooltip() {
  refs.tooltip.classed("visible", false);
}

function isYes(value) {
  return String(value).trim().toLowerCase() === "yes";
}

function parseReadableDate(value) {
  const match = value.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (!match) {
    return new Date(value);
  }

  const [, monthName, day, year] = match;
  return new Date(Number(year), MONTH_INDEX[monthName], Number(day), 12);
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatDateRange(start, end) {
  if (formatIsoDate(start) === formatIsoDate(end)) {
    return formatLongDate(start);
  }

  if (formatMonth(start) === formatMonth(end)) {
    return `${formatMonthShort(start)} ${start.getDate()}-${end.getDate()}`;
  }

  return `${formatMonthShort(start)} ${start.getDate()} - ${formatMonthShort(
    end
  )} ${end.getDate()}`;
}

function clampSceneRange(range) {
  return [
    new Date(Math.max(range[0].getTime(), model.fullRange[0].getTime())),
    new Date(Math.min(range[1].getTime(), model.fullRange[1].getTime())),
  ];
}

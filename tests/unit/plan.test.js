import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceCursor,
  buildChapterList,
  chapKey,
  dailyQuota,
  defaultPlan,
  estimateMinutesFromVerses,
  isChapterCredited,
  isChapterReadToday,
  isDailyPlanComplete,
  isExtraCredit,
  isInGoalRange,
  loadPlan,
  markChapterRead,
  canMarkChapter,
  canMarkBeyondPlan,
  nextMarkTarget,
  nextBeyondPlanTarget,
  nextChapterInBible,
  nextUnreadInGoal,
  progressPct,
  quotaPreview,
  resetPlanAll,
  resetPlanProgress,
  savePlan,
  todayAssignment,
  todayKey,
  accruePlan,
  readingMinutes,
  planFinishDate,
  notePortionChapter,
} from "../../web/plan.js";
import { miniBooks, toRoman } from "../fixtures/books.js";

beforeEach(() => {
  localStorage.clear();
});

describe("plan basics", () => {
  it("todayKey is YYYY-MM-DD", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("chapKey joins book and chapter", () => {
    expect(chapKey("01-gen", 3)).toBe("01-gen/3");
  });

  it("defaultPlan starts disabled with empty progress", () => {
    const p = defaultPlan();
    expect(p.enabled).toBe(false);
    expect(p.readToday).toEqual([]);
    expect(p.day).toBe(todayKey());
  });

  it("loadPlan returns default when empty / corrupt", () => {
    expect(loadPlan().enabled).toBe(false);
    localStorage.setItem("ksiag-plan-v1", "{not-json");
    expect(loadPlan().enabled).toBe(false);
  });

  it("savePlan + loadPlan round-trip", () => {
    const p = defaultPlan();
    p.enabled = true;
    p.chaptersPerDay = 7;
    savePlan(p);
    expect(loadPlan().chaptersPerDay).toBe(7);
    expect(loadPlan().enabled).toBe(true);
  });

  it("loadPlan clears readToday when day changes", () => {
    const p = defaultPlan();
    p.enabled = true;
    p.day = "2000-01-01";
    p.readToday = ["01-gen/1"];
    savePlan(p);
    const loaded = loadPlan();
    expect(loaded.day).toBe(todayKey());
    expect(loaded.readToday).toEqual([]);
  });
});

describe("quota", () => {
  it("dailyQuota chapters mode", () => {
    expect(dailyQuota({ mode: "chapters", chaptersPerDay: 3 })).toBe(3);
    expect(dailyQuota({ mode: "chapters", chaptersPerDay: 0 })).toBe(1);
  });

  it("dailyQuota time mode rounds minutes / 3", () => {
    expect(dailyQuota({ mode: "time", minutesPerDay: 15 })).toBe(5);
    expect(dailyQuota({ mode: "time", minutesPerDay: 3 })).toBe(1);
  });

  it("quotaPreview uses copy formatters", () => {
    const copy = {
      quotaChapters: (q) => `${q} ch`,
      quotaTime: (m, q) => `${m}min→${q}`,
    };
    expect(quotaPreview({ mode: "chapters", chaptersPerDay: 2 }, copy)).toBe("2 ch");
    expect(quotaPreview({ mode: "time", minutesPerDay: 9 }, copy)).toBe("9min→3");
  });
});

describe("estimateMinutesFromVerses", () => {
  it("returns at least 1 minute for short text", () => {
    const est = estimateMinutesFromVerses([{ t: "In the beginning." }]);
    expect(est.minutes).toBe(1);
    expect(est.words).toBeGreaterThan(0);
  });

  it("strips tags when counting words", () => {
    const est = estimateMinutesFromVerses([{ t: "And <i>God</i> said light." }]);
    expect(est.words).toBe(4);
  });
});

describe("buildChapterList + navigation", () => {
  const books = miniBooks();

  it("builds full bible list", () => {
    const list = buildChapterList(books, { goal: "bible" });
    expect(list[0]).toBe("01-gen/1");
    expect(list.at(-1)).toBe("66-apo/2");
    expect(list).toContain("40-mat/1");
    expect(list.length).toBe(3 + 2 + 2 + 2);
  });

  it("builds ST / NT / range", () => {
    expect(buildChapterList(books, { goal: "st" })).toEqual([
      "01-gen/1",
      "01-gen/2",
      "01-gen/3",
      "02-exo/1",
      "02-exo/2",
    ]);
    expect(buildChapterList(books, { goal: "nt" })[0]).toBe("40-mat/1");
    expect(
      buildChapterList(books, {
        goal: "range",
        fromBook: "01-gen",
        fromChapter: 2,
        toBook: "01-gen",
        toChapter: 3,
      })
    ).toEqual(["01-gen/2", "01-gen/3"]);
  });

  it("nextChapterInBible walks books and ends at last", () => {
    expect(nextChapterInBible(books, "01-gen", 1)).toEqual({ book: "01-gen", chapter: 2 });
    expect(nextChapterInBible(books, "01-gen", 3)).toEqual({ book: "02-exo", chapter: 1 });
    expect(nextChapterInBible(books, "66-apo", 2)).toBeNull();
    expect(nextChapterInBible(books, "nope", 1)).toBeNull();
  });
});

describe("marking progress", () => {
  const books = miniBooks();

  function enabledPlan(extra = {}) {
    return {
      ...defaultPlan(),
      enabled: true,
      chaptersPerDay: 2,
      mode: "chapters",
      goal: "bible",
      ...extra,
    };
  }

  it("markChapterRead is off when plan disabled", () => {
    const { kind } = markChapterRead(defaultPlan(), "01-gen", 1);
    expect(kind).toBe("off");
  });

  it("marks plan then extra after quota", () => {
    let plan = enabledPlan();
    let r = markChapterRead(plan, "01-gen", 1);
    expect(r.kind).toBe("plan");
    plan = r.plan;
    r = markChapterRead(plan, "01-gen", 2);
    expect(r.kind).toBe("plan");
    plan = r.plan;
    expect(isDailyPlanComplete(plan)).toBe(true);
    expect(progressPct(plan)).toBe(100);
    r = markChapterRead(plan, "01-gen", 3, books);
    expect(r.kind).toBe("extra");
    expect(isExtraCredit(r.plan, "01-gen", 3)).toBe(true);
    expect(progressPct(r.plan)).toBe(100);
    expect(markChapterRead(plan, "01-gen", 5, books).kind).toBe("skip");
  });

  it("already returns already", () => {
    let plan = enabledPlan();
    plan = markChapterRead(plan, "01-gen", 1).plan;
    expect(markChapterRead(plan, "01-gen", 1).kind).toBe("already");
    expect(isChapterReadToday(plan, "01-gen", 1)).toBe(true);
  });

  it("nextUnreadInGoal skips read chapters", () => {
    let plan = enabledPlan({ chaptersPerDay: 3 });
    plan = markChapterRead(plan, "01-gen", 1).plan;
    plan = advanceCursor(plan, books);
    const next = nextUnreadInGoal(books, plan);
    expect(next).toEqual({ book: "01-gen", chapter: 2, index: 1 });
  });

  it("todayAssignment builds range and href", () => {
    const plan = enabledPlan({ chaptersPerDay: 2 });
    const asg = todayAssignment(books, plan, toRoman);
    expect(asg.done).toBe(false);
    expect(asg.href).toBe("/porcja/01-gen/1");
    expect(asg.range).toContain("Gen");
    expect(asg.minutes).toBeGreaterThan(0);
  });

  it("todayAssignment continue href follows last marked, not browse position", () => {
    let plan = enabledPlan({ chaptersPerDay: 3 });
    plan = markChapterRead(plan, "01-gen", 1, books).plan;
    plan = advanceCursor(plan, books);
    const asg = todayAssignment(books, plan, toRoman);
    expect(asg.done).toBe(false);
    expect(asg.href).toBe("/porcja/01-gen/2");
    expect(asg.started).toBe(true);
    expect(nextMarkTarget(books, plan)).toEqual({ book: "01-gen", chapter: 2 });
  });

  it("todayAssignment done when quota filled", () => {
    let plan = enabledPlan({ chaptersPerDay: 1 });
    plan = markChapterRead(plan, "01-gen", 1).plan;
    const asg = todayAssignment(books, plan, toRoman);
    expect(asg.done).toBe(true);
  });

  it("resetPlanProgress clears today but keeps settings", () => {
    let plan = enabledPlan({ chaptersPerDay: 9 });
    plan = markChapterRead(plan, "01-gen", 1).plan;
    plan = resetPlanProgress(plan);
    expect(plan.readToday).toEqual([]);
    expect(plan.chaptersPerDay).toBe(9);
    expect(plan.enabled).toBe(true);
  });

  it("resetPlanAll restores defaults", () => {
    let plan = enabledPlan();
    plan = markChapterRead(plan, "01-gen", 1).plan;
    plan = resetPlanAll();
    expect(plan.enabled).toBe(false);
    expect(plan.readToday).toEqual([]);
  });

  it("progressPct null when disabled", () => {
    expect(progressPct(defaultPlan())).toBeNull();
  });

  it("only next chapter after furthest credited can be marked", () => {
    let plan = enabledPlan({ chaptersPerDay: 2 });
    expect(nextMarkTarget(books, plan)).toEqual({ book: "01-gen", chapter: 1 });
    expect(canMarkChapter(books, plan, "01-gen", 2)).toBe(false);
    expect(markChapterRead(plan, "01-gen", 2, books).kind).toBe("skip");

    plan = markChapterRead(plan, "01-gen", 1, books).plan;
    expect(nextMarkTarget(books, plan)).toEqual({ book: "01-gen", chapter: 2 });
    plan = markChapterRead(plan, "01-gen", 2, books).plan;
    expect(isDailyPlanComplete(plan)).toBe(true);
    expect(nextBeyondPlanTarget(books, plan)).toEqual({ book: "01-gen", chapter: 3 });
    expect(canMarkBeyondPlan(books, plan, "01-gen", 3)).toBe(true);
    expect(markChapterRead(plan, "02-exo", 1, books).kind).toBe("skip");
    const extra = markChapterRead(plan, "01-gen", 3, books);
    expect(extra.kind).toBe("extra");
    plan = extra.plan;
    expect(nextMarkTarget(books, plan)).toEqual({ book: "02-exo", chapter: 1 });
  });

  it("after reset only the goal start can be marked", () => {
    let plan = enabledPlan({ chaptersPerDay: 2 });
    plan = markChapterRead(plan, "01-gen", 1, books).plan;
    plan = markChapterRead(plan, "01-gen", 2, books).plan;
    plan = resetPlanProgress(plan);
    expect(nextMarkTarget(books, plan)).toEqual({ book: "01-gen", chapter: 1 });
    expect(canMarkChapter(books, plan, "01-gen", 2)).toBe(false);
    expect(markChapterRead(plan, "01-gen", 2, books).kind).toBe("skip");
    expect(markChapterRead(plan, "01-gen", 1, books).kind).toBe("plan");
  });

  it("credited chapters in goal stay read via cursor; outside goal never", () => {
    let plan = enabledPlan({ chaptersPerDay: 2, goal: "nt" });
    expect(isInGoalRange(books, plan, "01-gen", 1)).toBe(false);
    expect(isInGoalRange(books, plan, "40-mat", 1)).toBe(true);
    expect(canMarkChapter(books, plan, "01-gen", 1)).toBe(false);
    expect(nextMarkTarget(books, plan)).toEqual({ book: "40-mat", chapter: 1 });

    plan = markChapterRead(plan, "40-mat", 1, books).plan;
    plan = advanceCursor(plan, books);
    expect(isChapterCredited(books, plan, "40-mat", 1)).toBe(true);

    // nowy dzień: readToday puste, kursor zostaje — nadal „Przeczytany”
    plan = { ...plan, day: todayKey(), readToday: [] };
    expect(isChapterCredited(books, plan, "40-mat", 1)).toBe(true);
    expect(nextMarkTarget(books, plan)).toEqual({ book: "40-mat", chapter: 2 });
  });

  it("nextMarkTarget stays inside goal range", () => {
    let plan = enabledPlan({ chaptersPerDay: 1, goal: "nt" });
    plan = markChapterRead(plan, "40-mat", 1, books).plan;
    plan = markChapterRead(plan, "40-mat", 2, books).plan;
    plan = markChapterRead(plan, "66-apo", 1, books).plan;
    plan = markChapterRead(plan, "66-apo", 2, books).plan;
    expect(isDailyPlanComplete(plan)).toBe(true);
    // po ostatnim rozdziale celu — brak kolejnego do zaliczenia
    expect(nextMarkTarget(books, plan)).toBeNull();
  });
});

describe("dues and estimates", () => {
  const books = miniBooks();
  function enabledPlan(extra = {}) {
    return {
      ...defaultPlan(),
      enabled: true,
      chaptersPerDay: 2,
      mode: "chapters",
      goal: "bible",
      ...extra,
    };
  }

  it("adds one quota for each missed day and keeps the remainder", () => {
    const plan = enabledPlan({ chaptersPerDay: 3, owed: 0, pile: 3, beyond: true, day: "2020-01-01" });
    const next = accruePlan(plan, "2020-01-04");
    expect(next.day).toBe("2020-01-04");
    expect(next.owed).toBe(9);
    expect(next.pile).toBe(9);
    expect(next.beyond).toBe(false);
    expect(next.readToday).toEqual([]);
  });

  it("keeps a leftover when the next day arrives", () => {
    const plan = enabledPlan({ chaptersPerDay: 3, owed: 2, pile: 3, day: "2020-01-01" });
    const next = accruePlan(plan, "2020-01-02");
    expect(next.owed).toBe(5);
    expect(next.pile).toBe(5);
  });

  it("never reports zero minutes while a portion remains", () => {
    expect(readingMinutes(0, { mode: "chapters", chaptersPerDay: 3 })).toBeNull();
    expect(readingMinutes(1, { mode: "chapters", chaptersPerDay: 3 })).toBe(3);
    expect(readingMinutes(1, { mode: "time", minutesPerDay: 10 })).toBe(4);
  });

  it("rounds the finish date up, counting today", () => {
    const plan = enabledPlan({ chaptersPerDay: 3, cursor: 0 });
    const date = planFinishDate(books, plan, new Date(2026, 4, 10));
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(4);
    expect(date.getDate()).toBe(12);
  });

  it("shrinks the pile only from the portion reader", () => {
    const plan = enabledPlan({ chaptersPerDay: 3, owed: 3, pile: 3 });
    const next = notePortionChapter(plan);
    expect(next.owed).toBe(2);
    expect(notePortionChapter({ ...next, owed: 0 }).owed).toBe(0);
  });
});

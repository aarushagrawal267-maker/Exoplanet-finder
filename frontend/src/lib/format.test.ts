import { describe, expect, it } from "vitest";
import {
  EMPTY,
  formatBkjd,
  formatBytes,
  formatDateTime,
  formatDays,
  formatDuration,
  formatEta,
  formatHours,
  formatInt,
  formatKepid,
  formatNumber,
  formatPercent,
  formatPpm,
  formatProbability,
  formatRelativeTime,
  formatSigma,
  formatWithError,
} from "./format";

const MINUS = "−";

describe("formatNumber", () => {
  it("uses fixed digits, en-US grouping and a true minus sign", () => {
    expect(formatNumber(6712.345, { digits: 1 })).toBe("6,712.3");
    expect(formatNumber(-0.5, { digits: 2 })).toBe(`${MINUS}0.50`);
    expect(formatNumber(1234567, { digits: 0, group: false })).toBe("1234567");
  });
  it("never prints a negative zero", () => {
    expect(formatNumber(-0.0001, { digits: 2 })).toBe("0.00");
  });
  it("adds + only when signed and positive", () => {
    expect(formatNumber(1.5, { digits: 1, signed: true })).toBe("+1.5");
    expect(formatNumber(0, { digits: 1, signed: true })).toBe("0.0");
  });
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])("renders %s as an em dash", (v) => {
    expect(formatNumber(v as number)).toBe(EMPTY);
  });
});

describe("science units", () => {
  it("formats ppm (integers above 10 ppm)", () => {
    expect(formatPpm(6712.4)).toBe("6,712 ppm");
    expect(formatPpm(4.26)).toBe("4.3 ppm");
    expect(formatPpm(6712.4, { unit: false })).toBe("6,712");
    expect(formatPpm(null)).toBe(EMPTY);
  });
  it("formats days with precision adapted to magnitude", () => {
    expect(formatDays(2.204735)).toBe("2.2047 d");
    expect(formatDays(129.94)).toBe("129.94 d");
    expect(formatDays(1459.49)).toBe("1,459.5 d");
    expect(formatDays(2.2, { digits: 1, unit: false })).toBe("2.2");
  });
  it("formats hours", () => {
    expect(formatHours(4.0236)).toBe("4.02 h");
    expect(formatHours(4.0236, { digits: 1, unit: false })).toBe("4.0");
  });
  it("formats BKJD without grouping", () => {
    expect(formatBkjd(1131.5123456)).toBe("1131.5123 BKJD");
    expect(formatBkjd(121.1, { digits: 1, unit: false })).toBe("121.1");
  });
  it("formats percentages from fractions", () => {
    expect(formatPercent(0.8731)).toBe("87.3%");
    expect(formatPercent(0.05, { digits: 0 })).toBe("5%");
    expect(formatPercent(-0.012, { signed: true })).toBe(`${MINUS}1.2%`);
  });
  it("formats and clamps probabilities", () => {
    expect(formatProbability(0.87314)).toBe("0.873");
    expect(formatProbability(1.2)).toBe("1.000");
    expect(formatProbability(-0.1)).toBe("0.000");
    expect(formatProbability(0.5, { digits: 2 })).toBe("0.50");
    expect(formatProbability(undefined)).toBe(EMPTY);
  });
  it("formats sigma and value ± error", () => {
    expect(formatSigma(3.24)).toBe("3.2σ");
    expect(formatWithError(6712.3, 45.1)).toBe("6,712 ± 45");
    expect(formatWithError(6712.3, null, { unit: "ppm" })).toBe("6,712 ppm");
    expect(formatWithError(2.2, -0.01, { digits: 2, unit: "d" })).toBe("2.20 ± 0.01 d");
  });
  it("formats integers and Kepler ids", () => {
    expect(formatInt(150000.4)).toBe("150,000");
    expect(formatKepid(10666592)).toBe("KIC 10666592");
    expect(formatKepid("011442793")).toBe("KIC 11442793");
    expect(formatKepid("abc")).toBe(EMPTY);
  });
});

describe("durations and sizes", () => {
  it("formats durations across scales", () => {
    expect(formatDuration(0.4)).toBe("<1 s");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(185)).toBe("3 min 05 s");
    expect(formatDuration(3720)).toBe("1 h 02 min");
    expect(formatDuration(183600)).toBe("2 d 3 h");
    expect(formatDuration(-1)).toBe(EMPTY);
  });
  it("formats ETA text", () => {
    expect(formatEta(185)).toBe("about 3 min 05 s left");
    expect(formatEta(0.2)).toBe("almost done");
    expect(formatEta(null)).toBe(EMPTY);
  });
  it("formats bytes with decimal SI units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(3_200_000)).toBe("3.2 MB");
    expect(formatBytes(1_100_000_000)).toBe("1.1 GB");
    expect(formatBytes(-5)).toBe(EMPTY);
  });
});

describe("dates", () => {
  it("formats date-times in UTC", () => {
    expect(formatDateTime("2026-11-14T19:42:10Z")).toBe("2026-11-14 19:42 UTC");
    expect(formatDateTime("not a date")).toBe(EMPTY);
  });
  it("formats relative times", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    expect(formatRelativeTime("2026-11-14T11:59:50Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-14T11:55:00Z", now)).toBe("5 min ago");
    expect(formatRelativeTime("2026-11-14T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("2026-11-12T12:00:00Z", now)).toBe("2 d ago");
    expect(formatRelativeTime("2026-01-01T00:00:00Z", now)).toBe("2026-01-01 00:00 UTC");
  });
});

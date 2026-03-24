"use client";

import type { RangeOptionId } from "./types";
import { RANGE_OPTIONS, MONTHS } from "./types";
import type { DiscoveryAction } from "./reducer";

export function TimeSelectView({
  selectedRange,
  customRange,
  target,
  busy,
  isAuthenticated,
  yearOptions,
  customRangeIsValid,
  dispatch,
  onAnalyze,
  onValidateTarget,
  onBack,
}: {
  selectedRange: RangeOptionId;
  customRange: {
    phase: "start" | "end";
    startYear: number | null;
    startMonth: number | null;
    endYear: number | null;
    endMonth: number | null;
  };
  target: {
    mode: boolean;
    usernameInput: string;
    validationState: "idle" | "validating" | "valid" | "error";
    validationMessage: string | null;
  };
  busy: boolean;
  isAuthenticated: boolean;
  yearOptions: number[];
  customRangeIsValid: boolean;
  dispatch: React.Dispatch<DiscoveryAction>;
  onAnalyze: () => void;
  onValidateTarget: () => void;
  onBack: () => void;
}) {
  return (
    <main className="mp-page">
      <section className="mp-panel mp-panel-narrow">
        <button className="mp-back" onClick={onBack}>
          ← Back
        </button>
        <p className="mp-kicker">SELECT LISTENING WINDOW</p>
        <h2>How far back should we look?</h2>
        <p className="mp-muted">Choose a listening window for lane analysis.</p>

        <div className="mp-range-grid">
          {RANGE_OPTIONS.map((range) => (
            <button
              key={range.id}
              className={`mp-range-card ${selectedRange === range.id ? "is-selected" : ""}`}
              onClick={() => dispatch({ type: "SET_SELECTED_RANGE", range: range.id })}
            >
              <span>{range.label}</span>
              <small>{range.desc}</small>
            </button>
          ))}
        </div>

        {selectedRange === "custom" && (
          <section className="mp-custom-range">
            <p className="mp-kicker">MONTH-LEVEL RANGE</p>
            {customRange.phase === "start" ? (
              <>
                <p className="mp-muted">Pick your start month (earliest January 2000).</p>
                <div className="mp-custom-grid">
                  <select
                    className="mp-select"
                    value={customRange.startYear ?? ""}
                    onChange={(e) => dispatch({ type: "SET_CUSTOM_START_YEAR", year: Number(e.target.value) })}
                  >
                    <option value="">Start year</option>
                    {yearOptions.map((year) => (
                      <option key={`start-year-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <select
                    className="mp-select"
                    value={customRange.startMonth ?? ""}
                    onChange={(e) => dispatch({ type: "SET_CUSTOM_START_MONTH", month: Number(e.target.value) })}
                    disabled={!customRange.startYear}
                  >
                    <option value="">Start month</option>
                    {MONTHS.map((month, idx) => (
                      <option key={`start-month-${month}`} value={idx + 1}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mp-actions-row mp-actions-left">
                  <button
                    className="mp-button mp-button-ghost"
                    onClick={() => {
                      if (!customRange.startYear || !customRange.startMonth) return;
                      dispatch({ type: "ADVANCE_CUSTOM_TO_END" });
                    }}
                    disabled={!customRange.startYear || !customRange.startMonth}
                  >
                    Continue to end month
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mp-muted">Now pick your end month. Range is inclusive by full month.</p>
                <div className="mp-custom-grid">
                  <select
                    className="mp-select"
                    value={customRange.endYear ?? ""}
                    onChange={(e) => dispatch({ type: "SET_CUSTOM_END_YEAR", year: Number(e.target.value) })}
                  >
                    <option value="">End year</option>
                    {yearOptions.map((year) => (
                      <option key={`end-year-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <select
                    className="mp-select"
                    value={customRange.endMonth ?? ""}
                    onChange={(e) => dispatch({ type: "SET_CUSTOM_END_MONTH", month: Number(e.target.value) })}
                    disabled={!customRange.endYear}
                  >
                    <option value="">End month</option>
                    {MONTHS.map((month, idx) => (
                      <option key={`end-month-${month}`} value={idx + 1}>
                        {month}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mp-actions-row mp-actions-left">
                  <button className="mp-button mp-button-ghost" onClick={() => dispatch({ type: "SET_CUSTOM_PHASE", phase: "start" })}>
                    Edit start month
                  </button>
                </div>
                {!customRangeIsValid && customRange.endYear && customRange.endMonth && (
                  <p className="mp-inline-error">End month must be after or equal to the start month.</p>
                )}
              </>
            )}
          </section>
        )}

        <div className={`mp-center-cta ${selectedRange === "custom" ? "is-after-custom" : ""}`}>
          <button
            className="mp-button mp-button-primary"
            onClick={onAnalyze}
            disabled={
              busy ||
              !isAuthenticated ||
              (selectedRange === "custom" && !customRangeIsValid) ||
              (target.mode && target.validationState !== "valid")
            }
          >
            {target.mode ? "Analyze This User" : "Analyze My Taste"}
          </button>
        </div>

        <div className="mp-target-toggle-row">
          {!target.mode ? (
            <button className="mp-tertiary-action" onClick={() => dispatch({ type: "SET_TARGET_MODE", mode: true })} disabled={busy}>
              ANALYZE A DIFFERENT USER
            </button>
          ) : (
            <button className="mp-tertiary-action" onClick={() => dispatch({ type: "RESET_TARGET_USER" })} disabled={busy}>
              USE MY ACCOUNT INSTEAD
            </button>
          )}
        </div>

        {target.mode && (
          <section className="mp-target-user-panel">
            <label className="mp-kicker" htmlFor="target-username-input">
              TARGET LAST.FM USERNAME
            </label>
            <div className="mp-target-user-row">
              <input
                id="target-username-input"
                className="mp-input"
                value={target.usernameInput}
                onChange={(event) => dispatch({ type: "SET_TARGET_INPUT", value: event.target.value })}
                placeholder="username"
              />
              <button
                className="mp-button mp-button-ghost mp-button-compact"
                onClick={onValidateTarget}
                disabled={busy || target.validationState === "validating"}
              >
                {target.validationState === "validating" ? "Validating..." : "Validate"}
              </button>
            </div>
            {target.validationMessage && (
              <p className={`mp-target-note ${target.validationState === "error" ? "is-error" : ""}`}>
                {target.validationMessage}
              </p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

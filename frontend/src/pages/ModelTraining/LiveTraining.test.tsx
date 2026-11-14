import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fxExperimentDetail, fxJob } from "../_ops/testFixtures";
import { FakeEventSource, mockApi, renderRoute } from "../_ops/testUtils";
import { LiveTraining, mergeEpochs } from "./LiveTraining";

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

const job = fxJob({ id: "j1", kind: "train", title: "Train Two-view CNN", params: { experiment_id: 31 }, progress: 0.1, message: "epoch 0/3" });
const runningExp = { ...fxExperimentDetail, model_type: "cnn_two_view", status: "running", epochs: [], val_metrics: {}, config: { max_epochs: 3, ensemble_size: 1 } };

describe("LiveTraining", () => {
  it("merges stored and live epochs (live wins)", () => {
    const merged = mergeEpochs([{ epoch: 1, train_loss: 0.9, val_loss: 0.8 }], { 1: { epoch: 1, train_loss: 0.7 }, 2: { epoch: 2, val_pr_auc: 0.6 } });
    expect(merged).toEqual([
      { epoch: 1, train_loss: 0.7, val_loss: 0.8, val_pr_auc: undefined, val_roc_auc: undefined },
      { epoch: 2, val_pr_auc: 0.6 },
    ]);
  });

  it("draws curves from SSE epoch events, shows the log and cancels", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const api = mockApi([
      { path: "/jobs/j1", body: job },
      { path: "/experiments/31", body: runningExp },
      { method: "POST", path: "/jobs/j1/cancel", body: { ...job, status: "cancelled" } },
    ]);
    renderRoute(<LiveTraining jobId="j1" initial={job} onDismiss={() => undefined} />);
    expect(await screen.findByText("Waiting for the first epoch…")).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances.some((e) => e.url === "/api/jobs/j1/events")).toBe(true));
    const es = FakeEventSource.instances.find((e) => e.url === "/api/jobs/j1/events") as FakeEventSource;
    act(() => {
      es.open();
      es.emit("snapshot", job);
      es.emit("epoch", { experiment_id: 31, model_type: "cnn_two_view", member: 0, epoch: 1, global_epoch: 1, train_loss: 0.69, val_loss: 0.7, val_pr_auc: 0.5, val_roc_auc: 0.55, best_epoch: 1, n_members: 1, max_epochs: 3 });
      es.emit("log", { line: "[22:31:40] Two-view CNN: epoch 1/3, val PR-AUC 0.500" });
      es.emit("progress", { progress: 0.33, message: "Two-view CNN: epoch 1/3, val PR-AUC 0.500", status: "running", eta_s: 14 });
    });
    await waitFor(() => expect(screen.queryByText("Waiting for the first epoch…")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Training and validation loss by epoch")).toBeInTheDocument();
    expect(screen.getByLabelText("Training log")).toHaveTextContent("epoch 1/3, val PR-AUC 0.500");
    expect(screen.getByText("about 14 s left")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/jobs/j1/cancel")).toBe(true));
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MergePointCloudsDialog from "./MergePointCloudsDialog";

const SOURCES = [
  { id: 1, date: "2026-11-05", name: "scan_01.las", format: "LAS", has_saved_alignment: true },
  { id: 2, date: "2026-11-10", name: "scan_02.ply", format: "PLY", has_saved_alignment: false },
  { id: 3, date: "2026-11-15", name: "scan_03.laz", format: "LAZ", has_saved_alignment: false },
];

const preview = (over = {}) => ({
  project_name: "Project A",
  month_label: "November 2026",
  output_name: "November_2026_Merged_PointCloud.ply",
  sources: SOURCES,
  excluded_sources: [],
  missing_sources: [],
  eligible_count: 3,
  can_merge: true,
  running: null,
  latest: null,
  latest_completed: null,
  ...over,
});

const completed = (over = {}) => ({
  id: 9,
  status: "completed",
  file_url: "http://x/media/merged_pointclouds/project_7/November_2026_Merged_PointCloud.ply",
  point_count: 1234567,
  total_source_files: 3,
  voxel_size: 0.021,
  min_fitness: 0.82,
  max_rmse: 0.012,
  completed_at: "2026-11-18T10:00:00Z",
  created_by: "eng",
  is_stale: false,
  ...over,
});

function setup(props = {}) {
  const handlers = {
    loadPreview: jest.fn().mockResolvedValue(preview()),
    onStart: jest.fn().mockResolvedValue({}),
    onView: jest.fn(),
    onClose: jest.fn(),
  };
  const utils = render(
    <MergePointCloudsDialog
      year={2026}
      month={11}
      projectName="Project A"
      job={null}
      starting={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...utils, ...handlers, ...props };
}

const primary = (name) => screen.getByRole("button", { name });

test("confirms project, month and the files to be merged", async () => {
  const { loadPreview } = setup();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("November 2026")).toBeInTheDocument();
  await screen.findByText("scan_02.ply");
  expect(loadPreview).toHaveBeenCalledWith(2026, 11);
  expect(screen.getByText("Project A")).toBeInTheDocument();
  expect(screen.getByTestId("merge-file-count")).toHaveTextContent("3 point cloud files");
  expect(screen.getByText(/November_2026_Merged_PointCloud\.ply/)).toBeInTheDocument();
  expect(screen.getByText(/LAS · saved alignment/)).toBeInTheDocument();
  expect(screen.getAllByText(/auto-register/)).toHaveLength(2);
  expect(primary(/Merge 3 point clouds/)).toBeEnabled();
});

test("Merge starts the job; Cancel and Escape close without merging", async () => {
  const user = userEvent.setup();
  const { onStart, onClose } = setup();
  await user.click(await screen.findByRole("button", { name: /Merge 3 point clouds/ }));
  expect(onStart).toHaveBeenCalledWith({ force: false });
  await user.click(primary("Cancel"));
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onStart).toHaveBeenCalledTimes(1);
});

test("while a job runs the button is disabled and progress is shown", async () => {
  setup({ job: { id: 4, status: "running", progress: 0.42, stage_label: "Registering scan_02.ply" } });
  await screen.findByText("scan_02.ply");
  expect(primary(/Merging… 42%/)).toBeDisabled();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  expect(screen.getByText("Registering scan_02.ply")).toBeInTheDocument();
  expect(primary("Close")).toBeInTheDocument();
});

test("starting state disables the button (no duplicate requests)", async () => {
  const { onStart } = setup({ starting: true });
  await screen.findByText("scan_02.ply");
  const btn = primary(/Starting…/);
  expect(btn).toBeDisabled();
  await userEvent.setup().click(btn);
  expect(onStart).not.toHaveBeenCalled();
});

test("an up-to-date result can be viewed or regenerated", async () => {
  const user = userEvent.setup();
  const done = completed();
  const { onView, onStart } = setup({
    loadPreview: jest.fn().mockResolvedValue(preview({ latest: done, latest_completed: done })),
  });
  expect(await screen.findByText("Merged point cloud ready.")).toBeInTheDocument();
  expect(screen.getByText(/1,234,567 points from 3 files · voxel 2\.1 cm/)).toBeInTheDocument();
  expect(screen.getByText(/min overlap 82%, max RMSE 1\.2 cm/)).toBeInTheDocument();
  await user.click(primary(/View merged/));
  expect(onView).toHaveBeenCalledWith(done);
  await user.click(primary(/Regenerate/));
  expect(onStart).toHaveBeenCalledWith({ force: true });
});

test("a stale result is flagged and regeneration is offered", async () => {
  const done = completed({ is_stale: true });
  setup({ loadPreview: jest.fn().mockResolvedValue(preview({ latest: done, latest_completed: done })) });
  expect(await screen.findByText("Merged point cloud is out of date.")).toBeInTheDocument();
  expect(screen.getByText(/added, replaced or re-aligned/)).toBeInTheDocument();
  expect(primary(/Regenerate/)).toBeEnabled();
});

test("an alignment failure lists the affected files and metrics", async () => {
  const failed = {
    id: 5,
    status: "failed",
    error_message: "1 scan(s) could not be aligned reliably.",
    failed_sources: [
      { id: 3, name: "scan_03.laz", date: "2026-11-15", reason: "Too little overlap.", fitness: 0.12, rmse: 0.4 },
    ],
  };
  setup({ loadPreview: jest.fn().mockResolvedValue(preview({ latest: failed })) });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Merge failed.");
  expect(alert).toHaveTextContent("scan_03.laz (2026-11-15): Too little overlap. [overlap 12%, RMSE 40.0 cm]");
  expect(primary(/Merge 3 point clouds/)).toBeEnabled();
});

test("a rejected start request shows the server error", async () => {
  const user = userEvent.setup();
  setup({
    onStart: jest.fn().mockResolvedValue({
      error: "1 point cloud file(s) for November 2026 are missing from storage.",
      failed_sources: [{ id: 2, name: "scan_02.ply", reason: "The file is missing from storage." }],
    }),
  });
  await user.click(await screen.findByRole("button", { name: /Merge 3 point clouds/ }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("missing from storage");
  expect(alert).toHaveTextContent("scan_02.ply");
});

test("missing files block merging; unreadable formats are listed as left out", async () => {
  setup({
    loadPreview: jest.fn().mockResolvedValue(
      preview({
        excluded_sources: [{ id: 8, name: "site.e57", format: "E57", reason: "E57 files cannot be read" }],
        missing_sources: [{ id: 9, name: "gone.ply", reason: "The file is missing from storage." }],
      }),
    ),
  });
  expect(await screen.findByText("site.e57")).toBeInTheDocument();
  expect(screen.getByText(/Left out \(1\)/)).toBeInTheDocument();
  expect(screen.getByText(/Missing files \(1\)/)).toBeInTheDocument();
  expect(primary(/Merge 3 point clouds/)).toBeDisabled();
});

test("an empty month cannot be merged", async () => {
  setup({ loadPreview: jest.fn().mockResolvedValue(preview({ sources: [], eligible_count: 0 })) });
  expect(await screen.findByText(/No readable point cloud files were uploaded in November 2026/)).toBeInTheDocument();
  expect(primary(/Merge/)).toBeDisabled();
});

test("viewers can open a result but not start a merge", async () => {
  const done = completed();
  setup({
    loadPreview: jest.fn().mockResolvedValue(
      preview({ can_merge: false, latest: done, latest_completed: done }),
    ),
  });
  expect(await screen.findByText(/cannot create them/)).toBeInTheDocument();
  expect(primary(/View merged/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Regenerate|Merge \d/ })).not.toBeInTheDocument();
});

test("preview errors can be retried", async () => {
  const user = userEvent.setup();
  const loadPreview = jest
    .fn()
    .mockRejectedValueOnce({ response: { data: { error: "You are not assigned to this project." } } })
    .mockResolvedValue(preview());
  setup({ loadPreview });
  expect(await screen.findByText("You are not assigned to this project.")).toBeInTheDocument();
  await user.click(primary("Retry"));
  expect(await screen.findByText("scan_02.ply")).toBeInTheDocument();
});

test("the preview refreshes when the tracked job finishes", async () => {
  const loadPreview = jest.fn().mockResolvedValue(preview());
  const props = { loadPreview, onStart: jest.fn(), onView: jest.fn(), onClose: jest.fn() };
  const { rerender } = render(
    <MergePointCloudsDialog year={2026} month={11} job={{ id: 1, status: "running", progress: 0.9 }} {...props} />,
  );
  await screen.findByText("scan_02.ply");
  rerender(
    <MergePointCloudsDialog year={2026} month={11} job={completed()} {...props} />,
  );
  await waitFor(() => expect(loadPreview).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Merged point cloud ready.")).toBeInTheDocument();
});

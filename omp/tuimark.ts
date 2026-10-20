/**
 * tuimark for omp (https://github.com/ucalyptus/tuimark).
 *
 * `/tuimark [path] [--view split|edit|preview]` and the `tuimark_open` tool open tuimark
 * in a pane beside omp. Needs `tuimark` on PATH and omp running inside herdr or tmux.
 * Install: copy this file to ~/.omp/agent/extensions/tuimark.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const VIEWS = ["split", "edit", "preview"] as const;
type View = (typeof VIEWS)[number];

function launchRequest(args: string[], cwd: string, focus: boolean): { where: string; request: Record<string, unknown> } {
	if (process.env.HERDR_PANE_ID) {
		// omp runs the command from a /bin/sh script typed into the new pane's shell; closing the pane after tuimark quits keeps it from lingering.
		return {
			where: "herdr pane",
			request: { multiplexer: "herdr", placement: "pane", command: ["sh", "-c", 'tuimark "$@"; herdr pane close "$HERDR_PANE_ID"', "tuimark", ...args], cwd, focus },
		};
	}
	if (process.env.TMUX) {
		return {
			where: "tmux pane",
			request: { multiplexer: "tmux", placement: "pane", command: ["tuimark", ...args], cwd, focus, execution: "direct" },
		};
	}
	throw new Error("tuimark opens in a side pane, which needs omp running inside herdr or tmux; run `tuimark` in another terminal instead");
}

export default function (pi: ExtensionAPI) {
	async function open(ctx: ExtensionContext, target: string | undefined, view: View, focus: boolean, signal?: AbortSignal) {
		if (!ctx.ui.openTerminal) throw new Error("tuimark's pane needs the interactive omp TUI");
		const resolved = path.resolve(ctx.cwd, target ?? ".");
		if (!fs.existsSync(resolved) && !fs.existsSync(path.dirname(resolved))) {
			throw new Error(`${path.dirname(resolved)} does not exist`);
		}
		const args = [resolved, "--view", view];
		const { where, request } = launchRequest(args, ctx.cwd, focus);
		const probe = await pi.exec("tuimark", ["--version"], { cwd: ctx.cwd, signal });
		if (probe.killed) throw new Error("tuimark was cancelled");
		if (probe.code !== 0) {
			const reason = (probe.stderr || probe.stdout).trim() || `exited with status ${probe.code}`;
			throw new Error(`tuimark is not runnable: ${reason}; is it on PATH (see https://github.com/ucalyptus/tuimark)?`);
		}
		const launched = await ctx.ui.openTerminal(request as Parameters<NonNullable<ExtensionContext["ui"]["openTerminal"]>>[0]);
		const shown = path.relative(ctx.cwd, resolved) || ".";
		return { text: `Opened tuimark ${shown} (${view}) in a ${where}.`, warning: launched?.warning };
	}

	pi.registerCommand("tuimark", {
		description: "Edit/preview markdown with tuimark in a side pane ([path] [--view split|edit|preview])",
		handler: async (text, ctx) => {
			try {
				// Whitespace-separated, honouring single and double quotes.
				const args = [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
				let view: View = "split";
				let target: string | undefined;
				for (let i = 0; i < args.length; i++) {
					const arg = args[i];
					const flag = arg.startsWith("--view=") ? arg.slice("--view=".length) : arg === "--view" || arg === "-v" ? args[++i] : undefined;
					if (flag !== undefined) {
						if (!VIEWS.includes(flag as View)) throw new Error(`--view must be one of ${VIEWS.join(", ")}`);
						view = flag as View;
					} else if (arg === "-p" || arg === "--preview") view = "preview";
					else if (arg === "-e" || arg === "--edit") view = "edit";
					else target = arg;
				}
				const outcome = await open(ctx, target, view, true);
				ctx.ui.notify(outcome.warning ? `${outcome.text} ${outcome.warning}` : outcome.text, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerTool({
		name: "tuimark_open",
		label: "tuimark",
		description:
			"Open tuimark, a markdown editor with live rendered preview, for the user in a terminal pane beside omp. " +
			"Use it to show the user a markdown document (plan, README, notes) you wrote or want them to read or edit, " +
			"rather than pasting it into chat. The pane live-reloads when the file changes on disk, so keep editing the file " +
			"after opening it. `path` is a markdown file (created on first save if missing) or a directory to browse; " +
			"`view` is split (editor + preview, default), edit, or preview (read-only reader).",
		parameters: pi.zod.object({
			path: pi.zod.string().optional(),
			view: pi.zod.enum(VIEWS).optional(),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			// The user may be typing, so the pane opens without taking focus.
			const outcome = await open(ctx, params.path, params.view ?? "split", false, signal);
			const text = [outcome.text, outcome.warning].filter(Boolean).join("\n");
			return { content: [{ type: "text", text }], details: { path: params.path, view: params.view ?? "split" } };
		},
	});
}

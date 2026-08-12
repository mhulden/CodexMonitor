/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAppShellOrchestration } from "./useLayoutOrchestration";

const isWindowsPlatformMock = vi.hoisted(() => vi.fn());
const isLinuxPlatformMock = vi.hoisted(() => vi.fn());

vi.mock("@utils/platformPaths", () => ({
  isWindowsPlatform: isWindowsPlatformMock,
  isLinuxPlatform: isLinuxPlatformMock,
}));

function buildArgs() {
  return {
    isCompact: false,
    isPhone: false,
    isTablet: false,
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    shouldReduceTransparency: false,
    isWorkspaceDropActive: false,
    centerMode: "chat" as const,
    selectedDiffPath: null,
    showComposer: true,
    activeThreadId: "thread-1",
    sidebarWidth: 280,
    rightPanelWidth: 360,
    chatDiffSplitPositionPercent: 50,
    planPanelHeight: 220,
    terminalPanelHeight: 240,
    debugPanelHeight: 200,
    appSettings: {
      uiFontFamily: "system-ui",
      codeFontFamily: "monospace",
      codeFontSize: 12,
    },
  };
}

function styleEntries(style: CSSProperties) {
  return style as Record<string, string | undefined>;
}

describe("useAppShellOrchestration", () => {
  it("enables custom window chrome spacing on Linux", () => {
    isWindowsPlatformMock.mockReturnValue(false);
    isLinuxPlatformMock.mockReturnValue(true);

    const { result } = renderHook(() => useAppShellOrchestration(buildArgs()));
    const style = styleEntries(result.current.appStyle);

    expect(result.current.appClassName).toContain("is-linux");
    expect(result.current.appClassName).toContain("uses-custom-window-chrome");
    expect(style["--sidebar-top-padding"]).toBe("10px");
    expect(style["--window-caption-width"]).toBe("138px");
    expect(style["--home-scroll-offset"]).toBe("var(--main-topbar-height, 44px)");
  });

  it("keeps non-custom chrome spacing on macOS-like platforms", () => {
    isWindowsPlatformMock.mockReturnValue(false);
    isLinuxPlatformMock.mockReturnValue(false);

    const { result } = renderHook(() => useAppShellOrchestration(buildArgs()));
    const style = styleEntries(result.current.appStyle);

    expect(result.current.appClassName).not.toContain("uses-custom-window-chrome");
    expect(style["--sidebar-top-padding"]).toBe("36px");
    expect(style["--window-caption-width"]).toBe("0px");
    expect(style["--home-scroll-offset"]).toBe("0px");
  });
});

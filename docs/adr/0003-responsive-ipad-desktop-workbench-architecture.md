# ADR 0003: Responsive Parenting Workbench Architecture for iPad and Desktop

- Status: accepted
- Date: 2026-08-31

## Context

The Baby Panel frontend was initially constrained to a fixed 430px mobile column (`--app-max-width: 430px`), optimized strictly for mobile phones. 
However, parents and caregivers frequently interact with the system on **iPads and tablet devices** (iPad Mini 768px, iPad Air/Pro 11" 834px, iPad Pro 12.9" 1024px+), both in portrait and landscape orientations, as well as desktop browsers.
Restricting wide screens to a 430px narrow column severely underutilizes screen real estate, hinders data density, and creates excessive vertical scrolling. Conversely, simply stretching mobile cards without structural reorganization results in sparse layouts and awkward interaction ergonomics.

## Decisions

1. **Dual-Mode Shell and Breakpoint Hierarchy**:
   - **Mobile Mode (`< 1024px` / Small screens)**: Retain native-like mobile app experience with bottom navigation bar (`BottomNav`), safe-area insets for notches, and full-width card flows.
   - **Workbench Mode (`≥ 1024px` / iPad Landscape & Desktop)**: Transition to a dual-pane workbench layout featuring a fixed/collapsible left `DesktopSidebar` (240px) and a responsive multi-column main stage (`max-w-7xl`).
   - **iPad Portrait (`768px - 1023px`)**: Adaptive layout utilizing compact navigation rail or bottom bar with multi-column responsive grid (2-column cards) to prevent cramped viewports.

2. **Touch-First Tablet Ergonomics (iPad-First)**:
   - Primary input target is touch / tap / gesture. All interactive targets MUST maintain a minimum size of 44x44px.
   - Prohibit mouse-hover-only triggers (e.g. actions must not hide strictly behind `:hover`). Provide explicit tap targets or action sheets.
   - Support iOS WebKit inertia scrolling, elastic bounce prevention where appropriate, and safe-area padding for iPad Home Bar (`env(safe-area-inset-bottom)`).

3. **In-Context Slide-Over Drawer and Modal Entry**:
   - On wide viewports, quick record actions (feeding, sleep, diaper, solid food, growth measurement) open an in-context **Slide-Over Drawer** (or modal sheet) instead of full-page navigation, preserving dashboard context and instantly updating the active state upon submission.

4. **Dual-Pane Quick AI Workspace**:
   - `QuickAiModal` transforms on wide screens into a dual-panel dialog (left: persistent session history list, right: multimodal streaming conversation & tool traces) with iPad touch-optimized scrolling and keyboard shortcut support.

## Consequences

- Vastly superior information density and situational awareness on iPad (viewing 24h timeline, feeding countdown, supplements, and AI suggestions simultaneously).
- Eliminates context-switching friction on tablet/desktop while maintaining 100% fidelity on mobile phones.
- Ensures zero regressions for touch accessibility on iPad Safari / PWA standalone mode.

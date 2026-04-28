# Onboarding UI Audit

Date: 2026-04-28

## Goal

The onboarding flow should feel like a polished macOS/iOS app setup experience, not a website form flow. Users should feel guided, calm, and carried through setup without thinking about implementation steps.

## Current Diagnosis

The welcome screen is closest to the desired direction: restrained, centered, branded, and emotionally clear. After that, the flow loses the native-app quality and becomes visually noisy.

The main issues are:

- Too many bordered containers compete for attention.
- Several screens create a card-in-card feeling through nested panels, grids, option cards, notices, summaries, and form groups.
- The legal screen is currently a large document card, which feels like a web compliance page rather than a setup assistant moment.
- The setup header, step rail, panels, and field groups all use visible chrome at the same time.
- Controls do not yet feel native enough. They are functional, but many read as generic web buttons, checkbox rows, and card choices.
- Summary/stats-style information appears as tiled cards or bordered rows, which makes the finish step feel old fashioned and dashboard-like.
- There are many horizontal and vertical lines. They create density, but not hierarchy.
- The flow relies too much on typing and form filling. Input methods need more variety, but the variety should be calm and purposeful.

## Specific Problem Areas

### `src/components/setup-onboarding.tsx`

This component owns the main onboarding sequence. It currently mixes several presentation models:

- poster-style welcome
- legal document reader
- setup assistant header
- form panels
- segmented choices
- card grids
- toggle rows
- summary cards
- embedded connection wizard

Each of those can be valid on its own, but together they make the flow feel stitched together rather than authored as one product surface.

The biggest design problem is that almost every stage creates its own local frame. The user sees container after container instead of one continuous assistant.

### `src/components/setup-wizard.tsx`

The embedded connection step still carries legacy card language:

- `setup-option-card`
- `setup-wizard-card`
- `setup-flow-panel`
- repeated `wizard-actions`
- troubleshooting blocks that resemble queue/admin UI

This makes account connection feel like an admin utility inside onboarding. It should feel like the app is handling the pairing process for the user.

### `src/app/globals.css`

The setup styles contain many overlapping visual treatments:

- `.setup-onboarding-head` has a framed glass panel.
- `.setup-onboarding-panel` has another framed glass panel.
- `.setup-choice-card` adds more boxes.
- `.setup-summary-card` and `.setup-review-panel` add another layer.
- `.setup-advanced`, `.setup-toggle-card`, `.setup-review-row`, and `.setup-native-group` add additional dividers.

Even when individual styles are restrained, the total effect is busy. The design needs fewer surfaces, not nicer surfaces.

## Design Direction

The target should be closer to Apple Setup Assistant:

- One main window surface.
- One clear title and one clear action per step.
- Minimal borders.
- Native-feeling grouped controls.
- Large calm whitespace.
- Progressive disclosure for advanced configuration.
- Fewer visible steps; the app should feel like it knows where the user is.
- Motion should guide transitions, not decorate the page.

This does not mean copying Apple UI. It means adopting the same discipline: fewer visible boxes, fewer competing states, and controls that feel quiet, inevitable, and touchable.

## Recommended UI Model

Use one onboarding shell:

- full-screen dark app background
- centered setup assistant window, max width around 760-880px
- no separate header card plus body card
- brand in the top corner or centered only on welcome
- step title and helper copy at the top of the same surface
- content directly below, without an extra card wrapper
- bottom action bar with Back / Continue

The shell should be the only "window." Everything inside should be groups, rows, segmented controls, text areas, and sheets, not more cards.

## Input Method Plan

To prevent boredom without adding clutter, vary input types by task:

- Welcome: single primary button.
- Legal: short policy summary with "Read details" disclosure, not a giant document as the first visual.
- Service: segmented control for Managed / Self-hosted.
- Security: PIN fields with native validation and a small lock-state indicator.
- Profile: guided prompt chips plus one large textarea.
- Defaults: segmented controls, sliders/steppers, and native switches instead of option cards.
- Connect: automatic QR preparation with a large centered QR area and simple status text.
- Finish: compact review list, not stat cards.

Avoid adding novelty for novelty's sake. Input variety should reduce effort.

## Visual Rules For The Redesign

- No cards inside cards.
- No more than one framed surface on a screen.
- Use dividers only inside grouped lists, not around every item.
- Replace option cards with segmented controls where choices are mutually exclusive.
- Replace checkbox cards with native switch rows.
- Replace summary cards with a two-column definition list.
- Keep border radius at 8px or less.
- Keep letter spacing at 0 for normal headings.
- Keep buttons compact and native: primary, secondary, destructive only.
- Use one accent: white/system-neutral. Avoid colorful dashboard states in setup.
- Make every screen pass a "remove all borders" test: hierarchy should still be understandable.

## Proposed Implementation Phases

### Phase 1: Remove Excess Containers

- Collapse `setup-onboarding-head` and `setup-onboarding-panel` into one setup assistant surface.
- Remove the panel border/background from ordinary stages.
- Convert `setup-summary-card` into plain review rows.
- Remove decorative borders from `setup-soul-panel` and `setup-review-panel`.

### Phase 2: Replace Webby Controls

- Convert `setup-choice-card` groups to segmented controls.
- Convert `setup-toggle-card` rows to switch rows.
- Convert quiet-hours selects into compact time controls.
- Keep profile chips, but make them secondary input aids, not visual decoration.

### Phase 3: Rework Legal And Connection

- Legal should start with a concise acceptance screen and put full documents in a scrollable disclosure/sheet.
- WhatsApp connection should show one large pairing state, not multiple nested status/action sections.
- Move troubleshooting behind a disclosure unless an error is active.

### Phase 4: Polish Motion And Responsiveness

- Use one step transition animation.
- Respect reduced-motion preferences.
- On mobile, remove the step rail and show only "Step x of y" plus a small progress indicator.
- Ensure no text is trapped in narrow chips or cards.

## Acceptance Criteria

The redesigned onboarding should pass these checks:

- At any stage, there is only one primary visual surface.
- Users can identify the current task in under two seconds.
- The next action is obvious without reading all copy.
- Advanced controls do not appear unless requested.
- The finish screen looks like a review sheet, not a dashboard.
- Mobile does not feel like a compressed desktop card stack.
- The flow feels calm enough to be an app setup experience, not a SaaS onboarding page.

## Priority Recommendation

Do not polish the current card stack further. The better move is to simplify the information architecture and restyle around one assistant shell. The current system has enough useful pieces, but the visual model is over-composed. The next implementation should remove chrome before adding more controls.

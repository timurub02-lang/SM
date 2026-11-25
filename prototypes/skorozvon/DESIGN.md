---
name: SM CRM — local Skorozvon prototype
description: Scoped design record of the synthetic operator workspace
colors:
  accent: "#127d76"
  muted: "#52666f"
  line: "#dce6e3"
  ink: "#22343d"
  ground: "#f6f8f9"
  surface: "#ffffff"
  selected: "#e7f3ef"
  selected-ink: "#186356"
  control-border: "#bdceca"
  secondary-ink: "#284d48"
  danger-ink: "#a22b28"
typography:
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  title:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "17px"
    fontWeight: 700
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "8px"
  surface: "12px"
spacing:
  tight: "8px"
  compact: "12px"
  regular: "16px"
  section: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.control}"
    padding: "11px 14px"
  button-danger:
    backgroundColor: "#fff1f0"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.control}"
    padding: "11px 14px"
---

# Design System: SM CRM — local Skorozvon prototype

## Overview

### Local SDK extension, 2026-11-25

`live.html` inherits the same CRM palette, Arial typography, bordered surfaces and responsive composition. It adds a380px vendor panel (350px below1000px) alongside a test-card mapping form and event list. At740px it stacks with the phone first. The official vendor login/control surface keeps its own styling; local CSS does not reskin it. The inherited6px badges and7px fields remain intentional. An explicit load action separates arrival from loading the third-party SDK; loading, failed loading, signed-out, authorized and ready states have text. This shipped view has been verified up to the vendor login screen only; authenticated calling states are not visually certified.

**Creative North Star: "Existing CRM operator workspace"**

An extension of the existing SM CRM operator workspace: teal actions, white bordered surfaces and a pale neutral ground. This scoped record describes the finished local simulation in index.html, style.css and app.mjs; it does not establish a new identity for the parent CRM or imply a live Skorozvon connection.

**Key Characteristics:**
- Restrained, flat surfaces with visible boundaries.
- Compact readable controls and explicit call states.
- Customer context beside the call on desktop, below it on narrow screens.

## Colors

The existing CRM palette supplies a quiet neutral workspace with a teal action accent.

### Primary
- **CRM teal** (`accent`): primary actions, focus outlines and input caret.
- **Selected teal wash** (`selected`) and **deep state teal** (`selected-ink`): selected customer, phase labels and contextual icon surfaces.

### Neutral
- **Pale ground**, **white surface**, **soft divider** (`ground`, `surface`, `line`): workspace, panels and boundaries.
- **Dark ink** and **muted slate** (`ink`, `muted`): principal content and supporting information.
- **Control border** and **secondary ink** (`control-border`, `secondary-ink`): input outlines and secondary actions.
- **Danger ink** (`danger-ink`): error feedback and end-call action, a semantic exception to the teal palette.

**The Action and State Rule.** Use teal for primary actions and pale teal for selected context and call status; reserve red for ending a call and errors.

## Typography

Arial, Helvetica, sans-serif is the inherited functional text stack. The repeated compact hierarchy uses body text, smaller labels and modest section titles rather than a new display identity. Supporting prose varies between 1.5 and 1.7 line height; customer notes stop at 65ch. Telephone metadata and the elapsed-time counter use tabular numerals. Field labels are 13px semibold; buttons are 14px semibold. These roles remain legible without uppercase decorative kickers.

## Layout

The desktop container is capped at 1440px, with 34px vertical and 36px horizontal padding. The workspace places flexible customer content beside a 354px call panel, separated by 28px. The call panel is sticky 20px from the top; history follows customer context.

At 1000px and below, the call column narrows to 320px, the gap becomes 18px, and the client selector stacks. At 740px and below, the workspace becomes one column with the call panel first and non-sticky; page side padding becomes 16px. Metadata and history headers can wrap. Spacing commonly repeats 8, 12, 16 and 20px, with larger page-specific gutters.

## Elevation & Depth

**The Flat Surfaces Rule.** Separate panels with borders and background tones; the implemented surfaces have no shadows.

Keyboard focus uses an accent outline, 3px wide and offset 3px; selector focus is inset to remain visible within its clipped container. These outlines communicate focus rather than elevation.

## Shapes

White panel containers use the surface radius and fine divider borders. Actions use the control radius; fields have 7px corners. Small status labels have restrained 4–6px rounding. Customer initials and the SM wordmark are text, while action icons use inline SVG strokes, not font glyphs. No raster assets ship with this prototype.

## Components

### Buttons
Primary teal, outlined secondary and pale-red danger buttons share 11px by 14px padding and a minimum 44px height. Hover backgrounds change over 150ms; disabled actions use half opacity. Holding a call exposes pressed state. All actionable controls retain visible focus.

### Fields
Inputs, selects and textareas are white, outlined and at least 44px tall. Labels sit above them with an 8px gap. Disabled status selection uses the page ground. Callback date/time is shown only for the callback outcome; errors appear as explicit red text.

### Customer selector and containers
The selector is a segmented set of buttons on desktop, with a pale-teal selected surface and textual names. During a call and result capture, selection is disabled without fading its text. The customer card and phone panel share white fill, border and surface radius. History uses divided rows rather than repeated cards.

### Status and call panel
Phase labels combine text with a pale-teal background. The panel changes from call controls to the result form. Ending a call focuses the outcome field; saving focuses the next-call action. Unknown contacts show an explicit unmatched state. Results exist only in tab memory, reset on reload, and are labelled as such. The navigation brand returns to the prototype start.

### Motion
A changed customer card briefly fades from selected teal to white over 450ms ease-out. Reduced-motion preference disables animation and transitions. The system defines no shadow or entrance-motion vocabulary.

## Do's and Don'ts

### Do:
- Do retain the inherited CRM palette and body typography.
- Do pair state colors with text and preserve visible keyboard focus.
- Do keep synthetic-mode and tab-memory limitations visible.

### Don't:
- Don't describe simulated actions as successful provider operations.
- Don't replace the selected customer while a call or its result is active.


Not canonized: the inherited system-font page heading is retained as an incumbent extension detail, not promoted into a reusable display-face rule; isolated avatar, counter and heading measurements are not system tokens.

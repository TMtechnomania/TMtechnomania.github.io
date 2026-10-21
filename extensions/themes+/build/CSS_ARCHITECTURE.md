# CSS Architecture - Modular Design

## Overview

The CSS has been completely modularized for better maintainability and performance. Each component now has its own CSS file that is dynamically loaded only when needed.

## File Structure

### Base Styles

**File:** `css/base.css`

-   Core CSS variables (colors, typography, spacing)
-   Global reset and utility classes
-   Shared component styles (buttons, inputs, toggles)

### Primary Interface Modules

**File:** `css/actionbar.css`

-   Bottom control bar layout and animations
-   Loading state: Always loaded

**File:** `css/searchbar.css`

-   Search container, inputs, and engine selectors
-   Loading state: Dynamic (via `searchbar.js`)

**File:** `css/clock.css`

-   On-screen large clock styling and fonts
-   Loading state: Static (linked in `newtab.html`)

**File:** `css/ambientMode.css`

-   Zen Mode overlay, timer visualization, and glassmorphism effects
-   Loading state: Dynamic (via `ambientMode.js`)

**File:** `css/famcam.css`

-   Camera interface, flash controls, and screenshot overlay
-   Loading state: Dynamic (via `famcam.js`)

**File:** `css/userguide.css`

-   Styling for the User Guide page (`userguide.html`)

### Sidebar & Panel Modules

**File:** `css/tabs.css`

-   Vertical tabs ribbon layout
-   Loading state: Dynamic (on open)

**File:** `css/bookmarks.css`

-   Bookmarks side panel and folder hierarchy
-   Loading state: Dynamic (on open)

### Modal & Widget Modules

**File:** `css/settingsModal.css`

-   Main settings interface, tabs, and form controls
-   Loading state: Dynamic (on open)

**File:** `css/toolsModal.css`

-   Tools dashboard grid and utility widgets (Calculator, QR, etc.)
-   Loading state: Dynamic (on open)

**File:** `css/notesModal.css` & `css/notesWidget.css`

-   Notes management interface and desktop widget
-   Loading state: Dynamic

**File:** `css/alarmModal.css` & `css/timerModal.css`

-   Time management popups and controls
-   Loading state: Dynamic

## CSS Variables - New Naming Convention

### Responsive Scale (read this before adding any size)

Sizing is driven by the **root font-size**, which is fluid and keyed to the
viewport's short edge (`vmin`). Every component dimension is rem-based, so the
whole UI scales from one formula in `css/base.css`:

```css
html {
    font-size: calc(
        clamp(var(--scale-root-min), var(--scale-root-fluid), var(--scale-root-max)) *
            var(--ui-scale, 1)
    );
}
```

`--ui-scale` is the user's Small / Normal / Large preference
(Settings → UI Scaling) applied on top of the automatic scale. The automatic
per-screen part is pure CSS; the preference is the only piece JS sets
(`applyUiScale()` in `js/config.js`, called by `newtab.js` and `userguide.js`).

| Token                  | Value        | Meaning                                   |
| ---------------------- | ------------ | ----------------------------------------- |
| `--scale-root-min`     | `13px`       | floor (720p short edge)                   |
| `--scale-root-fluid`   | `1.4815vmin` | 16px at 1080p short edge                  |
| `--scale-root-max`     | `24px`       | ceiling (2160p and above)                 |

Resulting root size per display class, identical in **both** orientations:

| Display | Landscape   | Portrait    | Root  |
| ------- | ----------- | ----------- | ----- |
| 720p    | 1280 x 720  | 720 x 1280  | 13px  |
| 1080p   | 1920 x 1080 | 1080 x 1920 | 16px  |
| 1440p   | 2560 x 1440 | 1440 x 2560 | 21.3px|
| 2160p   | 3840 x 2160 | 2160 x 3840 | 24px  |

Because the formula tracks `vmin` and not width, **rotating a monitor never
rescales the UI** - it only re-flows it. Do not reintroduce width-only
`@media` font-size rules; they make landscape and portrait disagree.

### Layout bounds

| Token                  | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `--layout-edge`        | Clamped inset for full-screen panels (4% of the viewport, 1-4rem) |
| `--layout-gutter`      | Clamped gap used where a fixed gap would overflow narrow widths  |
| `--layout-safe-height` | `100% - 4rem dock margin` - max height for bottom-docked panels  |
| `--layout-safe-width`  | `100% - 2rem` - max width for floating panels/widgets            |

Rules of thumb:

- Cap panel widths with `min(<design rem>, <percentage>)` so a rotated
  (narrow) viewport shrinks the panel instead of clipping it.
- Use `justify-content: safe center` on scrollable centered rows (action bar,
  ribbons); plain `center` clips the leading edge once the row overflows.
- Prefer intrinsic layout over width breakpoints: the tools dashboard uses
  `column-count` (maximum) plus `column-width` (minimum) so it flows between 1
  and 5 columns with the actual panel width.
- Reflow panels with `@container` on the panel itself (`.settings-modal`,
  `.tools-modal` are size containers), not on window width.

### Sizing & Spacing

-   `--dis-x` / `--dis-N`: 0.25rem .. 20rem distance ramp (0.5rem steps), the primary spacing scale
-   `--width-N`: 4rem .. 160rem width ramp (4rem steps)
-   `--radius-container` / `--radius-child` / `--radius-xs` / `--radius-full`: derived radii
-   `--ui-scale`: **user preference multiplier** (0.8 / 1 / 1.2 from Settings → UI Scaling). Applied exactly once, on the root font-size - never multiply an individual component by it.

### Colors

-   `--color-primary`: Primary brand color (#0072ff)
-   `--color-primary-alpha`: Primary with transparency (#0072ff11)
-   `--color-surface`: Surface/background color (white)
-   `--color-surface-backdrop`: Backdrop overlay color
-   `--color-text-primary`: Primary text color (#111)
-   `--color-text-secondary`: Secondary text color (#444)
-   `--color-text-tertiary`: Tertiary text color (#777)

### Typography

-   `--font-family`: Main font family (Outfit + fallbacks)

### Border Radius

-   `--border-radius-full`: Full rounded (999px)
-   `--border-radius-chip`: Chip-specific radius

### Transitions

-   `--transition-fast`: Fast animations (0.18s ease)
-   `--transition-normal`: Normal animations (0.3s ease)

## Key Improvements

### 1. Modular Loading

-   CSS files are loaded on-demand via JavaScript
-   Reduces initial page load
-   Unloaded when features are closed (tabs, bookmarks)

### 2. Better Variable Names

-   Clear, semantic naming with prefixes (`ui-`, `color-`)
-   Consistent naming patterns
-   Easy to understand and maintain

### 3. No Shadows

-   All box-shadow properties removed
-   Cleaner, flatter design
-   Better performance

### 4. Fixed Collapsible Bookmarks

-   Corrected toggle logic (now properly inverts state)
-   Smooth transitions
-   Proper arrow indicator rotation
-   Children indent using `--ui-bar-height` for consistency

### 5. Consistent Design

-   All UI elements use the same variables
-   Unified transition timings
-   Consistent spacing and sizing

## Usage in JavaScript

### Loading CSS

```javascript
function loadCSS(href, id) {
	if (document.getElementById(id)) return;
	const link = document.createElement("link");
	link.id = id;
	link.rel = "stylesheet";
	link.href = href;
	document.head.appendChild(link);
}

// Example
loadCSS("css/bookmarks.css", "bookmarks-css");
```

### Unloading CSS

```javascript
function unloadCSS(id) {
	const link = document.getElementById(id);
	if (link) link.remove();
}

// Example
unloadCSS("bookmarks-css");
```

## Migration Notes

### Old Variable → New Variable

-   `--scale` → `--ui-scale`
-   `--gap` → `--ui-gap`
-   `--pad-y` → `--ui-padding-block`
-   `--pad-x` → `--ui-padding-inline`
-   `--chip-h` → `--ui-chip-height`
-   `--chip-icon` → `--ui-chip-icon-size`
-   `--pill-icon` → `--ui-pill-icon-size`
-   `--bar-h` → `--ui-bar-height`
-   `--primary` → `--color-primary`
-   `--primary-weak` → `--color-primary-alpha`
-   `--surface` → `--color-surface`
-   `--app-font` → `--font-family`

### Files Modified

1. `newtab.html` - Updated to load base.css and actionbar.css only
2. `js/searchbar.js` - Added CSS loading/unloading helpers
3. `js/newtab.js` - Added CSS loading for tabs and bookmarks, fixed bookmark collapse logic
4. `css/base.css` - New base styles file
5. `css/searchbar.css` - New searchbar module
6. `css/actionbar.css` - New action bar module
7. `css/tabs.css` - New tabs ribbon module
8. `css/bookmarks.css` - New bookmarks panel module

### Files to Remove (Optional)

-   `css/newtab.css` - Original monolithic CSS file (can be kept as backup)

## Browser Compatibility

-   All modern browsers supported
-   `-webkit-user-drag` used for WebKit browsers (Chrome, Edge, Safari)
-   Fallbacks in place for non-standard properties

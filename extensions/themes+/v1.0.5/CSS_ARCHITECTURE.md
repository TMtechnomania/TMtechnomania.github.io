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
-   Loading state: Dynamic

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

**File:** `css/mediaWidget.css`

-   Media control styling
-   Loading state: Dynamic

## CSS Variables - New Naming Convention

### Sizing & Spacing

-   `--ui-scale`: Global scale multiplier (1)
-   `--ui-gap`: Standard gap between elements
-   `--ui-padding-block`: Vertical padding
-   `--ui-padding-inline`: Horizontal padding
-   `--ui-chip-height`: Height of chip elements
-   `--ui-chip-icon-size`: Size of icons in chips
-   `--ui-pill-icon-size`: Size of icons in pills
-   `--ui-bar-height`: Height of bars (action bar, searchbar)

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

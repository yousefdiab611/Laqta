# Popup navigation and visual direction

Status: adopted

The requested redesign uses a dark dotted background and a vivid orange accent, inspired
by the supplied Nazil reference. The popup needs to expose the existing capture,
recording, and creation actions within Chrome's popup height limit.

Use a 400×600 RTL Arabic popup with three accessible tabs: capture, recording,
and creation. Keep the existing action IDs and event handlers. Place Studio,
history, and branding entry points in the shared footer. Isolate the design in
popup/laqta.css, with tab behavior in popup/navigation.js; the editor and Studio share the palette described in 0002-shared-interface-palette.md.

Tabs support RTL arrow keys, Home and End. Reduced-motion preferences retain a short fade and remove spatial animation. An active capture session replaces the tab panels; a restored
recording selects the recording panel. Error/status content can scroll within
the main area while the footer remains accessible.

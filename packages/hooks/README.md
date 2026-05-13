# @openloomi/hooks

A collection of pure React hooks extracted from the openloomi web app.

## Installation

```sh
pnpm add @openloomi/hooks
```

## Hooks

- `useLocalStorage` - SSR-safe localStorage hook
- `useIsMobile` - Mobile device detection
- `useOnClickOutside` - Click outside detection
- `useCustomEvent` - Custom DOM event listener
- `useMobileBottomSpacing` - Mobile bottom spacing measurement
- `useEnterSendWithIme` - IME-safe Enter-to-send hook
- `usePullToRefresh` - Pull-to-refresh gesture hook
- `useScrollToBottom` - Scroll-to-bottom with SWR state management

## Peer Dependencies

Requires `react >=18.0.0` and `swr >=2.0.0`.

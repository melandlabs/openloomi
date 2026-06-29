"use client";

/**
 * Connector authorization context — openloomi stub.
 *
 * The openloomi reference uses a ConnectorAuthorizationProvider that
 * surfaces in-flight OAuth flows to the UI. openloomi's Chronicle feature
 * doesn't depend on connectors, but `use-capability-authorization.ts`
 * imports `useConnectorAuthorizationOptional`, so we provide a no-op
 * provider + hook to satisfy the type checker.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface ConnectorAuthorizationOptions {
  platform: string;
  reason?: string;
  afterSuccess?: () => void;
}

export interface ConnectorAuthorizationState {
  /** Trigger a connector OAuth flow for the given platform. */
  authorize: (platform: string, reason?: string) => Promise<boolean>;
  /** Open the in-app connector authorization modal for the given platform. */
  openAuthorization: (options: ConnectorAuthorizationOptions) => void;
}

const noopAuthorize = async (
  _platform: string,
  _reason?: string,
): Promise<boolean> => false;

const noopOpenAuthorization = (
  _options: ConnectorAuthorizationOptions,
): void => {};

const defaultState: ConnectorAuthorizationState = {
  authorize: noopAuthorize,
  openAuthorization: noopOpenAuthorization,
};

const ConnectorAuthorizationContext =
  createContext<ConnectorAuthorizationState>(defaultState);

export function ConnectorAuthorizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useMemo(() => defaultState, []);
  return (
    <ConnectorAuthorizationContext.Provider value={value}>
      {children}
    </ConnectorAuthorizationContext.Provider>
  );
}

export function useConnectorAuthorization(): ConnectorAuthorizationState {
  return useContext(ConnectorAuthorizationContext);
}

export function useConnectorAuthorizationOptional():
  | ConnectorAuthorizationState
  | undefined {
  return useContext(ConnectorAuthorizationContext);
}

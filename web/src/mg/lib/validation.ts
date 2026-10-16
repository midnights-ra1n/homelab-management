/* Forms are validated by the server (Go); the browser only needs the answer's shape. */
export type FormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Incremented on each success to close the client dialogs. */
  nonce?: number;
};

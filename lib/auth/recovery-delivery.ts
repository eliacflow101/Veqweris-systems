export type RecoveryDelivery = {
  deliver(input: { email: string; institutionId: string; token: string; expiresAt: Date }): Promise<void>;
};

export const recoveryDelivery: RecoveryDelivery = {
  async deliver({ email, institutionId, expiresAt }) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Recovery delivery provider is not configured.");
    }
    console.info("Development recovery delivery queued.", {
      email,
      institutionId,
      expiresAt: expiresAt.toISOString(),
    });
  },
};

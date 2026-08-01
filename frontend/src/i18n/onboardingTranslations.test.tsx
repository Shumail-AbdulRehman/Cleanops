import { describe, expect, it } from "vitest";
import { billingUrdu } from "./billingTranslations";
import { onboardingUrdu } from "./onboardingTranslations";
import { translate } from "./translations";

// Approved prototype plus the recovery, confirmation, error and accessibility
// copy required by the screen specs. Existing dictionaries supply shared keys.
const requiredFlowKeys = [
  "Skip to content",
  "Test mode",
  "Setup progress",
  "Account",
  "Plan",
  "Card",
  "Workspace",
  "Welcome back",
  "Sign in to run today's work.",
  "Email or password is incorrect.",
  "Too many attempts. Try again in a few minutes.",
  "We could not reach Hygene Ops. Check your connection and try again.",
  "Email",
  "Password",
  "Forgot password?",
  "Show",
  "Hide",
  "Sign in",
  "New to Hygene Ops?",
  "Create an account",
  "Platform owner sign-in",
  "Create your account",
  "Next you'll choose a plan and add a card.",
  "This email already has an account.",
  "Sign in instead",
  "Your account could not be created. Your details are still here, so try again.",
  "Your account is ready. Sign in to continue.",
  "Your name",
  "Company name",
  "Work email",
  "Use at least 8 characters.",
  "Continue to plans",
  "Already have an account?",
  "Choose a plan",
  "Pick the size that fits your team. You can change it later.",
  "Billing interval",
  "Monthly",
  "Yearly",
  "Prices could not load.",
  "Try again",
  "Locations",
  "Staff",
  "Managers",
  "Price",
  "Starter",
  "For very small teams",
  "Pro",
  "Adds managers and automatic assignment",
  "Enterprise",
  "For larger operations",
  "What every plan includes",
  "GPS attendance and selfies",
  "Daily and one-time tasks",
  "Area QR and guided photo capture",
  "Photo review and history",
  "Your company owner uses one manager seat.",
  "Continue to payment",
  "Add your card",
  "Test mode. No real money moves.",
  "Use this card:",
  "Copy",
  "Copied",
  "Any future expiry date, any name, security code 100.",
  "That card was declined. Check the details or try another card.",
  "You're offline. Reconnect to continue. Your details stay here.",
  "We saved your checkout. Pick up where you left off.",
  "Processing your payment. Please keep this page open.",
  "Loading the secure card form",
  "Preview of Paddle's secure form",
  "The card form didn't load",
  "You have not been charged. A browser extension or a weak connection can block it.",
  "Order summary",
  "locations",
  "staff",
  "managers",
  "Subtotal",
  "Tax",
  "Calculated by Paddle",
  "Due today",
  "Then renews at",
  "Cancel anytime.",
  "Change plan",
  "Your card details go straight to Paddle. We never see them.",
  "Confirming your subscription",
  "This usually takes a few seconds. You won't be charged twice.",
  "Payment received",
  "Activating your subscription",
  "Preparing your workspace",
  "Taking a little longer than usual. You can stay here or come back later.",
  "We haven't heard back yet. Your payment is safe, so please don't pay again.",
  "Check again",
  "You're all set",
  "Your subscription is active and your workspace is ready.",
  "Next payment",
  "Open your workspace",
  "Your first step inside is adding a location.",
  "Checking your previous checkout",
  "We're asking Paddle what happened, so you don't pay twice.",
  "This takes a few seconds.",
  "Payments are unavailable right now",
  "Nothing was charged. Your account and plan choice are saved.",
  "This email is already used for payments",
  "Nothing was charged. Contact support to link it, or sign up with another email.",
  "Contact support",
  "This account is restricted",
  "Company operations are on hold. Payment doesn't lift this. Contact support.",
  "Today",
  "Example day",
  "Morning check-ins",
  "Washrooms, second floor",
  "Lobby floors",
  "Kitchen photos to review",
  "Evening shift",
  "Your whole operation, worked down one sheet.",
  "What happens next",
  "Your details and company name",
  "Monthly or yearly, sized to your team",
  "Entered securely with Paddle",
  "Then add your first location",
  "You're only charged when you confirm your card.",
  "Creating your account…",
  "Signing in…",
  "This account is deactivated. Contact your company owner.",
  "You have a checkout in progress. Choosing a different plan replaces it. You have not been charged.",
  "More test cards",
  "Asks for bank approval (3D Secure)",
  "Always declined",
  "Reset your password",
  "For company owners. Managers and staff can ask their company owner.",
  "Send reset link",
  "If that email has an owner account, a reset link is on its way.",
  "Back to sign in",
  "Your work is in the app",
  "Attendance and cleaning tasks are in the Hygene Ops Android app your company gave you.",
  "Sign out",
  "Washrooms",
  "Done",
  "Submitted",
  "Review",
  "Later",
  "per month",
  "per year",
  "Billed monthly",
  "Billed yearly",
  "This field is required.",
  "Enter a valid email address.",
  "Too many attempts. Try again in {count} seconds.",
  "Preparing your checkout…",
  "Changing your plan. Please keep this page open.",
  "Paddle's secure card form is in English.",
  "Your previous checkout is still being checked. Please wait.",
  "We could not confirm your previous checkout. Check again before making another payment.",
  "Your account and plan choice are saved. Try again or contact support.",
  "Contact support to link this email, or sign up with another email.",
  "Sign up with another email",
  "The card form could not load. Check your connection or browser extensions and try again.",
  "Step completed",
  "Loading available plans…",
  "No plans are available for this billing interval.",
  "Includes {count} locations",
  "Includes {count} staff seats",
  "Includes {count} manager seats",
  "Sign in again",
  "Security details updated. Sign in again to continue.",
  "Show password",
  "Hide password",
  "New password",
  "Confirm new password",
  "Reset password",
  "Saving password…",
  "Verify owner email",
  "Reset owner password",
  "Confirm owner email",
  "Verifying…",
  "Opening this page does not use the link. Confirm below to continue. Completing this action requires signing in again.",
  "This link is missing or invalid. Open the complete link from your email. Reloading removes the temporary link for your security.",
  "This link is invalid, expired or already used. Request a new link.",
  "Use at least 8 characters and at most 72 UTF-8 bytes. Choose a different password.",
  "Enter matching new passwords, at least 8 characters and at most 72 UTF-8 bytes.",
  "Choose a different valid new password and try again.",
  "The password could not be changed. Check your connection and try again.",
  "Requesting recovery…",
  "Email recovery is unavailable. Contact your company owner or the configured support channel. Delivery has not been confirmed.",
  "Too many requests. Wait before trying again. Delivery has not been confirmed.",
  "The request could not be accepted. Check your connection and try again.",
  "Verification could not finish. Check your connection and try again.",
  "Check your inbox and spam folder. If no link arrives, contact the configured support channel.",
  "Android app information",
  "Open approved Android distribution",
  "Use only the distribution approved by your company. A download link does not confirm device qualification.",
  "Approved Android distribution is unavailable. Ask your company owner for the qualified app.",
  "You are signed in as {name}.",
  "Signing out…",
  "Sign out failed. Try again.",
];

const planNames = ["Starter", "Pro", "Enterprise"];
const trialWording = /\btrial\w*\b|ٹرائل|آزمائشی\s+مدت|مفت\s+(?:آزمائش|مدت)/iu;
const placeholders = (text: string) => [...text.matchAll(/\{[^{}]+\}/g)]
  .map(([token]) => token).sort();

describe("onboarding copy coverage", () => {
  it.each(requiredFlowKeys)("provides registered Urdu for %s", (key) => {
    const value = translate(key, "ur");
    expect(value.trim()).not.toBe("");
    if (planNames.includes(key)) expect(value).toBe(key);
    else expect(value).toMatch(/\p{Script=Arabic}/u);
    expect(placeholders(value)).toEqual(placeholders(key));
    expect(value).not.toMatch(trialWording);
    expect(translate(key, "en")).toBe(key);
  });

  it("validates every dictionary entry, including any added beyond the screen manifest", () => {
    for (const [key, value] of Object.entries(onboardingUrdu)) {
      expect(value.trim(), key).not.toBe("");
      if (!planNames.includes(key)) expect(value, key).toMatch(/\p{Script=Arabic}/u);
      expect(placeholders(value), key).toEqual(placeholders(key));
      expect(`${key} ${value}`, key).not.toMatch(trialWording);
    }
  });

  it("reuses billing keys, with only the approved Enterprise spelling overriding legacy copy", () => {
    expect(Object.keys(onboardingUrdu).filter((key) => Object.hasOwn(billingUrdu, key)))
      .toEqual(["Enterprise"]);
    for (const key of ["Skip to content", "Choose a plan", "Billing interval", "Monthly", "Yearly", "Try again", "Order summary", "Change plan", "Contact support"]) {
      expect(onboardingUrdu).not.toHaveProperty(key);
      expect(translate(key, "ur")).toBe(billingUrdu[key]);
    }
  });

  it.each([
    "For individuals and very small cleaning teams.",
    "For small cleaning companies managing multiple teams.",
    "For larger cleaning operations with more locations and staff.",
  ])("translates the server plan description %s", key => {
    expect(translate(key, "ur")).not.toBe(key);
    expect(translate(key, "ur")).toMatch(/[\u0600-\u06ff]/);
  });

  it("gives approved onboarding copy priority over older shared dictionaries", () => {
    expect(translate("Workspace", "ur")).toBe("ورک اسپیس");
    expect(translate("Sign in", "ur")).toBe("سائن ان");
    expect(translate("Enterprise", "ur")).toBe("Enterprise");
  });

  it("keeps Paddle and Hygene Ops exact wherever they appear", () => {
    for (const [key, value] of Object.entries(onboardingUrdu)) {
      for (const brand of ["Paddle", "Hygene Ops"]) {
        const occurrences = key.split(brand).length - 1;
        expect(value.split(brand).length - 1, key).toBe(occurrences);
      }
    }
  });

  it.each([0, 1, 30])("interpolates retry waits without losing a count of %i", (count) => {
    expect(translate("Too many attempts. Try again in {count} seconds.", "ur", { count }))
      .toBe(`بہت زیادہ کوششیں ہو گئیں۔ ${count} سیکنڈ بعد دوبارہ کوشش کریں۔`);
  });

  it("retains missing placeholders for later interpolation", () => {
    expect(translate("Too many attempts. Try again in {count} seconds.", "ur"))
      .toContain("{count}");
    expect(translate("Includes {count} locations", "ur")).toContain("{count}");
  });

  it("preserves supplied names, emails, amounts and direction-isolation markers", () => {
    const name = "\u2068Ayesha · owner@example.invalid · US$12.00\u2069";
    expect(translate("You are signed in as {name}.", "ur", { name })).toContain(name);
    expect(translate("You are signed in as {name}.", "en", { name }))
      .toBe(`You are signed in as ${name}.`);
    expect(translate("you@company.com", "ur")).toBe("you@company.com");
  });

  it("retains the existing English fallback for unregistered text", () => {
    expect(translate("Unregistered copy for {name}", "ur", { name: "Ayesha" }))
      .toBe("Unregistered copy for Ayesha");
  });
});

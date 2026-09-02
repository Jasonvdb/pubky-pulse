import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Privacy Policy — Pubky Pulse",
  description:
    "Learn what data Pubky Pulse collects and how a deployment handles it. Privacy policy for the Pubky Pulse observability platform.",
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <MarketingNav />
      <main
        className="min-h-screen pt-14"
        style={{ background: "oklch(0.12 0.015 55)" }}
      >
        <div className="mx-auto max-w-4xl px-6 py-16">
          <article className="prose prose-invert prose-lg max-w-none prose-headings:text-white prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-p:text-white/70 prose-p:leading-relaxed prose-li:text-white/70 prose-strong:text-white/90 prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline prose-ul:my-4 prose-li:my-1">
            <h1>Privacy Policy</h1>
            <p className="text-white/40 !mt-2 !mb-12 text-base">
              Effective date: March 24, 2026
            </p>

            <h2>Who We Are</h2>
            <p>
              Pubky maintains Pubky Pulse, an observability platform for web,
              backend and mobile apps. Pubky Pulse is self-hosted, MIT-licensed
              open-source software: every deployment is run and operated by
              whoever installed it, on their own infrastructure. This policy
              describes what the software collects and stores &mdash; the
              operator of the deployment you use is the party responsible for
              it.
            </p>

            <h2>Information We Collect</h2>

            <h3>Platform Users (You)</h3>
            <p>
              When you create a Pubky Pulse account, the following
              information is stored:
            </p>
            <ul>
              <li>
                <strong>Email address</strong> — used as your login identifier
              </li>
              <li>
                <strong>Name</strong> — auto-generated from your email address
                and editable in your profile
              </li>
            </ul>
            <p>
              Authentication is passwordless. We send a 6-digit verification
              code to your email when you sign in. Verification codes are hashed
              before storage and expire after 10 minutes.
            </p>

            <h3>End-User Data (Your Application&apos;s Users)</h3>
            <p>
              When your application uses our SDKs, the following data may be
              collected about your end users:
            </p>
            <ul>
              <li>
                <strong>Device information:</strong> device model, OS version,
                locale
              </li>
              <li>
                <strong>Approximate location:</strong> country (2-letter ISO
                code) derived from the visitor&apos;s IP address at the
                Cloudflare edge at request time. IP addresses themselves are
                never stored. No city, region, or precise location is collected.
              </li>
              <li>
                <strong>App information:</strong> app version, build number,
                bundle identifier
              </li>
              <li>
                <strong>Session data:</strong> session identifier (UUID,
                generated fresh on each app launch)
              </li>
              <li>
                <strong>User identifiers:</strong> anonymous ID
                (auto-generated) or user ID (if you call our identity API)
              </li>
              <li>
                <strong>Event data:</strong> log level, message, screen name,
                timestamps
              </li>
              <li>
                <strong>Custom attributes:</strong> key-value pairs that you
                explicitly send
              </li>
              <li>
                <strong>Network connection type</strong> (wifi, cellular,
                ethernet, or offline — attached to every event by the Swift and
                Android SDKs)
              </li>
            </ul>

            <h3>What We Do Not Collect</h3>
            <ul>
              <li>IP addresses</li>
              <li>GPS or precise location data</li>
              <li>Biometric data</li>
              <li>Browser fingerprints</li>
              <li>Advertising identifiers</li>
              <li>Contact lists, photos, or other device content</li>
            </ul>

            <h2>How the Data Is Used</h2>
            <ul>
              <li>Provide and operate the Pubky Pulse deployment you use</li>
              <li>Authenticate your account and maintain your session</li>
              <li>
                Send verification codes and team invitation emails
              </li>
              <li>Monitor service health and prevent abuse</li>
            </ul>
            <p>
              Pubky Pulse contains no advertising, profiling, or third-party
              tracking of any kind.
            </p>

            <h2>Data Storage and Security</h2>
            <ul>
              <li>
                Data is stored in a single PostgreSQL database on the
                infrastructure the operator chose
              </li>
              <li>
                API keys are SHA-256 hashed before storage — full keys are shown
                only once at creation
              </li>
              <li>Email verification codes are hashed before storage</li>
              <li>
                Authentication uses HTTP-only, secure cookies that are
                inaccessible to JavaScript
              </li>
              <li>
                The API is protected by rate limiting and request size guards
              </li>
              <li>
                All data in transit is encrypted via TLS (HTTPS)
              </li>
            </ul>
            <p>
              Because Pubky Pulse is self-hosted, your data stays entirely on the
              operator&apos;s own infrastructure.
            </p>

            <h2>Data Retention</h2>
            <ul>
              <li>
                Event data is retained until you delete it or until automatic
                pruning removes it (if you have configured a database size limit
                on your self-hosted instance)
              </li>
              <li>
                Deleted resources (projects, apps, API keys) are soft-deleted
                and permanently removed after 7 days
              </li>
              <li>Email verification codes expire after 10 minutes</li>
              <li>Team invitations expire after 7 days</li>
            </ul>

            <h2>Third-Party Services</h2>
            <p>
              Pubky Pulse ships with no analytics, advertising, or tracking
              services. A deployment needs one external service:
            </p>
            <ul>
              <li>
                <strong>Resend</strong> — email delivery for verification codes,
                team invitations, and notification emails
              </li>
            </ul>
            <p>
              Anything else &mdash; where the database and servers live, whether
              a CDN sits in front &mdash; is chosen by the operator of the
              deployment.
            </p>

            <h2>Cookies</h2>
            <p>Pubky Pulse uses a single authentication cookie:</p>
            <ul>
              <li>
                <strong>Name:</strong> <code>token</code>
              </li>
              <li>
                <strong>Purpose:</strong> maintains your authenticated session
              </li>
              <li>
                <strong>Type:</strong> HTTP-only, secure, SameSite=Lax
              </li>
              <li>
                <strong>Duration:</strong> 7 days
              </li>
            </ul>
            <p>
              This cookie is strictly necessary for the service to function. We
              do not use any tracking, analytics, or advertising cookies.
            </p>

            <h2>Our Role as a Data Processor</h2>
            <p>
              When you use Pubky Pulse to collect data about your application&apos;s
              users, you are the data controller and Pubky Pulse acts as a data
              processor (under GDPR) or service provider (under CCPA). This
              means:
            </p>
            <ul>
              <li>
                You determine what data is collected from your users and why
              </li>
              <li>
                We process that data solely to provide the Pubky Pulse service to
                you
              </li>
              <li>
                We do not sell, share, or use your end-user data for any purpose
                other than providing the service
              </li>
              <li>
                You are responsible for obtaining any necessary consents from
                your end users and for complying with applicable privacy laws
              </li>
            </ul>

            <h2>Your Rights Under GDPR</h2>
            <p>
              If you are located in the European Economic Area, you have the
              right to:
            </p>
            <ul>
              <li>
                <strong>Access</strong> your personal data
              </li>
              <li>
                <strong>Correct</strong> inaccurate personal data
              </li>
              <li>
                <strong>Delete</strong> your personal data
              </li>
              <li>
                <strong>Port</strong> your data to another service in a
                machine-readable format
              </li>
              <li>
                <strong>Restrict</strong> processing of your personal data
              </li>
              <li>
                <strong>Object</strong> to processing of your personal data
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact the operator of the Pubky
              Pulse deployment you use. The software provides the export and
              deletion endpoints they need to answer you.
            </p>

            <h2>Your Rights Under CCPA</h2>
            <p>
              If you are a California resident, you have the right to:
            </p>
            <ul>
              <li>
                <strong>Know</strong> what personal information we collect and
                how we use it
              </li>
              <li>
                <strong>Delete</strong> your personal information
              </li>
              <li>
                <strong>Opt out of the sale</strong> of your personal
                information — we do not sell personal information
              </li>
              <li>
                <strong>Non-discrimination</strong> for exercising your privacy
                rights
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact the operator of the Pubky
              Pulse deployment you use.
            </p>

            <h2>Children&apos;s Privacy</h2>
            <p>
              Pubky Pulse is not directed at children under 16 years of age. We do
              not knowingly collect personal information from children under 16.
              If you believe a deployment has collected information from a child
              under 16, contact its operator so they can delete it.
            </p>

            <h2>Changes to This Policy</h2>
            <p>
              This privacy policy may be updated from time to time. The
              effective date at the top of this page indicates when it was last
              revised.
            </p>

            <h2>Contact</h2>
            <p>
              Questions about the data a specific deployment holds go to its
              operator. Questions about how the software itself handles data can
              be raised at{" "}
              <a
                href="https://github.com/pubky/pubky-pulse"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/pubky/pubky-pulse
              </a>
              .
            </p>
          </article>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}

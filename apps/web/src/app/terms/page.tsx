import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata = {
  title: "Terms of Service — Pubky Pulse",
  description:
    "Terms of Service for Pubky Pulse, the agent-first observability platform for web, backend and mobile apps.",
};

export default function TermsPage() {
  return (
    <>
      <MarketingNav />
      <main className="pt-14" style={{ background: "oklch(0.12 0.015 55)" }}>
        <div className="mx-auto max-w-4xl px-6 py-16">
          <article className="prose prose-invert prose-lg max-w-none prose-headings:text-white prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-p:text-white/70 prose-p:leading-relaxed prose-li:text-white/70 prose-strong:text-white/90 prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline prose-ul:my-4 prose-li:my-1">
            <h1>Terms of Service</h1>
            <p>
              <strong>Effective date:</strong> March 24, 2026
            </p>

            <h2>Agreement to Terms</h2>
            <p>
              By accessing or using Pubky Pulse, you agree to be bound by these
              Terms of Service. If you do not agree to these terms, do not use
              the software.
            </p>
            <p>
              &ldquo;We,&rdquo; &ldquo;us,&rdquo; and &ldquo;our&rdquo; refer
              to Pubky. &ldquo;You&rdquo; and &ldquo;your&rdquo; refer
              to the person or entity using the software.
            </p>

            <h2>Service Description</h2>
            <p>
              Pubky Pulse is an observability platform for web, backend and
              mobile apps. It is self-hosted open-source software, and includes
              client SDKs (Node.js, Swift, Android), a Model Context Protocol
              (MCP) server, and an API. There is no hosted service &mdash; you
              run your own deployment. These terms govern your use of the Pubky
              Pulse software.
            </p>

            <h2>Accounts</h2>
            <p>
              You must provide a valid email address to create an account.
              Authentication is passwordless via email verification codes. You
              are responsible for maintaining the security of your account and
              API keys. You must not share your account with others. You must
              promptly notify us if you become aware of unauthorized access to
              your account.
            </p>

            <h2>Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use the service for any unlawful purpose</li>
              <li>
                Attempt to gain unauthorized access to the service or other
                users&apos; data
              </li>
              <li>
                Interfere with or disrupt the service or its infrastructure
              </li>
              <li>
                Circumvent rate limits or other technical restrictions
              </li>
              <li>
                Use the service to collect data in violation of applicable
                privacy laws
              </li>
              <li>
                Transmit malware, viruses, or harmful code through the service
              </li>
              <li>
                Scrape, crawl, or otherwise extract data from the service except
                through our APIs
              </li>
            </ul>

            <h2>Your Data</h2>
            <p>
              You retain all ownership rights to data you submit to Pubky Pulse.
              You grant us a limited, non-exclusive license to process your data
              solely to provide the service. We will not sell, share, or use your
              data for any purpose other than operating the service.
            </p>
            <p>
              When you delete data or terminate your account, we will delete your
              data in accordance with our privacy policy.
            </p>
            <p>
              You are solely responsible for the data you collect from your end
              users, including obtaining any required consents and complying with
              applicable privacy laws.
            </p>

            <h2>Open Source Software</h2>
            <p>
              Pubky Pulse &mdash; the server, MCP server, web dashboard,
              database layer, and the SDKs &mdash; is released under the MIT
              License. Your use of the software is governed by that license.
            </p>

            <h2>Intellectual Property</h2>
            <p>
              The Pubky Pulse name, logo, and branding are the property of
              Pubky. The source code is licensed under the MIT License. Nothing
              in these terms grants you rights to our trademarks or branding.
            </p>

            <h2>API and Rate Limits</h2>
            <p>
              The Pubky Pulse API applies rate limits, configured by the
              operator of the deployment. Default limits are documented in the
              API documentation.
            </p>

            <h2>Availability</h2>
            <p>
              Pubky Pulse is provided on an &ldquo;as is&rdquo; and
              &ldquo;as available&rdquo; basis. Availability of any given
              deployment is the responsibility of whoever operates it. We do not
              guarantee uninterrupted or error-free software.
            </p>

            <h2>Termination</h2>
            <p>
              You may stop using the software at any time. Account deletion is
              handled by the operator of the deployment you signed in to.
            </p>
            <p>
              The operator of a deployment may suspend or terminate your access
              to it at any time, including if your use poses a security risk or
              if required by law.
            </p>

            <h2>Disclaimer of Warranties</h2>
            <p className="uppercase">
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF
              ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
              WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
              UNINTERRUPTED, SECURE, OR ERROR-FREE.
            </p>

            <h2>Limitation of Liability</h2>
            <p className="uppercase">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, PUBKY SHALL NOT
              BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
              PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL,
              ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY
              CLAIMS ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE
              AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM, OR ONE
              HUNDRED DOLLARS ($100), WHICHEVER IS GREATER.
            </p>

            <h2>Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless Pubky from any
              claims, damages, losses, or expenses (including reasonable
              attorneys&apos; fees) arising from your use of the service, your
              violation of these terms, or your collection and processing of
              end-user data.
            </p>

            <h2>Governing Law</h2>
            <p>
              These terms are governed by the laws of the State of Wyoming,
              United States, without regard to conflict of law principles. Any
              disputes arising from these terms shall be resolved in the courts
              located in Wyoming.
            </p>

            <h2>Changes to These Terms</h2>
            <p>
              We may update these terms from time to time. The effective date at
              the top of this page indicates when the terms were last revised. If
              we make material changes, we will notify you by email at least 30
              days before the changes take effect. Your continued use of the
              service after changes take effect constitutes acceptance of the
              updated terms.
            </p>

            <h2>Contact</h2>
            <p>
              If you have questions about these terms, open an issue at{" "}
              <a
                href="https://github.com/pubky/pubky-pulse"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/pubky/pubky-pulse
              </a>
            </p>
          </article>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import { openUrl } from "@/lib/tauri";

export default function TermsOfService() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("summary");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);

      const scrollPosition = window.scrollY + 100;

      for (const [id, ref] of Object.entries(sectionRefs.current)) {
        if (ref) {
          const { offsetTop, offsetHeight } = ref;
          if (
            scrollPosition >= offsetTop &&
            scrollPosition < offsetTop + offsetHeight
          ) {
            setActiveSection(id);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const registerRef = (id: string, ref: HTMLElement | null) => {
    if (ref) {
      sectionRefs.current[id] = ref;
    }
  };

  const scrollToSection = (id: string) => {
    const ref = sectionRefs.current[id];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth" });
    }
  };

  const navItems = [
    { id: "summary", label: "Summary" },
    { id: "definitions", label: "A. Definitions" },
    { id: "account-terms", label: "B. Account Terms" },
    { id: "acceptable-use", label: "C. Acceptable Use" },
    { id: "user-content", label: "D. User-Generated Content" },
    { id: "data-privacy", label: "E. Data Privacy" },
    { id: "ai-features", label: "F. AI Features & Disclaimer" },
    { id: "copyright", label: "G. Copyright Policy" },
    { id: "intellectual-property", label: "H. Intellectual Property" },
    { id: "payment", label: "I. Fees and Payment" },
    { id: "liability", label: "J. Limitation of Liability" },
    { id: "restricted-regions", label: "K. Restricted Regions" },
    { id: "governing-law", label: "L. Governing Law & Arbitration" },
    { id: "miscellaneous", label: "M. Miscellaneous" },
  ];

  return (
    <>
      <Head>
        <title>openloomi Terms of Service</title>
        <meta name="description" content="Terms of Service for openloomi." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="pt-20 pb-16">
        <div className="container mx-auto px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="mb-10">
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                openloomi Terms of Service
              </h1>
              <p className="text-gray-500 mt-2">
                Effective Date: August 4, 2025 &nbsp;|&nbsp; Last Updated: March
                3, 2026
              </p>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
              {/* Desktop sidebar */}
              <aside className="hidden lg:block w-64 shrink-0 sticky top-24 self-start">
                <nav className="border border-gray-200 rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Table of Contents
                  </h2>
                  <ul className="space-y-1">
                    {navItems.map(({ id, label }) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => scrollToSection(id)}
                          className={`block w-full text-left px-3 py-2 rounded-md text-sm ${
                            activeSection === id
                              ? "bg-purple-50 text-purple-700 font-medium"
                              : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              </aside>

              <div className="flex-1">
                {/* Mobile TOC */}
                <div className="lg:hidden mb-6">
                  <details className="border border-gray-200 rounded-lg">
                    <summary className="px-4 py-3 font-medium cursor-pointer list-none">
                      Table of Contents
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="inline-block size-5 ml-2"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </summary>
                    <div className="px-4 py-2 space-y-1">
                      {navItems.map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => scrollToSection(id)}
                          className="block w-full text-left px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </details>
                </div>

                {/* Summary */}
                <section
                  id="summary"
                  ref={(el) => registerRef("summary", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">
                    Summary
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th
                            scope="col"
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            Section
                          </th>
                          <th
                            scope="col"
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            What You&apos;ll Find
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {[
                          [
                            "A. Definitions",
                            "Basic terms used throughout the agreement with specific meanings",
                          ],
                          [
                            "B. Account Terms",
                            "Requirements for having an account with openloomi",
                          ],
                          [
                            "C. Acceptable Use",
                            "Rules you must follow when using openloomi services",
                          ],
                          [
                            "D. User-Generated Content",
                            "Your rights and responsibilities regarding content you create",
                          ],
                          [
                            "E. Data Privacy",
                            "How openloomi handles your IM and email data and private information",
                          ],
                          [
                            "F. AI Features & Disclaimer",
                            "How openloomi uses AI and the limitations of AI-generated content",
                          ],
                          [
                            "G. Copyright Policy",
                            "How openloomi responds to copyright infringement claims",
                          ],
                          [
                            "H. Intellectual Property",
                            "openloomi\u2019 rights in its website and services",
                          ],
                          [
                            "I. Fees and Payment",
                            "Subscription plans, billing, refunds, and pricing",
                          ],
                          [
                            "J. Limitation of Liability",
                            "Caps on damages and disclaimers for indirect losses",
                          ],
                          [
                            "K. Restricted Regions",
                            "Geographic or legal restrictions on service access",
                          ],
                          [
                            "L. Governing Law & Arbitration",
                            "Singapore law and SIAC arbitration",
                          ],
                          [
                            "M. Miscellaneous",
                            "Severability, waiver, and other general provisions",
                          ],
                        ].map(([section, desc]) => (
                          <tr key={section}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {section}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {desc}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* A. Definitions */}
                <section
                  id="definitions"
                  ref={(el) => registerRef("definitions", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    A. Definitions
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> We use specific terms
                      throughout this agreement that have particular meanings.
                      Understanding them will help you interpret these terms.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      &quot;Account&quot; means your registered account with
                      openloomi, representing your legal relationship with us.
                    </p>

                    <p>
                      &quot;Agreement&quot; collectively refers to these Service
                      Terms, our Privacy Policy, and any other rules, policies,
                      or procedures we publish on our website.
                    </p>

                    <p>
                      &quot;Beta Previews&quot; refers to software, services, or
                      features identified as alpha, beta, preview, early access,
                      or evaluation versions.
                    </p>

                    <p>
                      &quot;Content&quot; includes all materials displayed or
                      transmitted through the Service, including but not limited
                      to text, data, messages, and software. &quot;User
                      Content&quot; means content created or uploaded by users.
                      &quot;Your Content&quot; refers to content you create or
                      own rights to.
                    </p>

                    <p>
                      &quot;openloomi,&quot; &quot;we,&quot; or &quot;us&quot;
                      refers to openloomi Inc., including our affiliates,
                      directors, employees, and agents.
                    </p>

                    <p>
                      &quot;Service&quot; means openloomi&apos; applications,
                      software, products, and services, including integrations
                      with Telegram, Slack, Gmail and any Beta Previews.
                    </p>

                    <p>
                      &quot;User,&quot; &quot;you,&quot; or &quot;your&quot;
                      refers to any individual or entity accessing or using the
                      Service. Users must be at least{" "}
                      <strong>18 years old</strong>, or the age of legal
                      majority in their jurisdiction, whichever is higher.
                    </p>
                  </div>
                </section>

                {/* B. Account Terms */}
                <section
                  id="account-terms"
                  ref={(el) => registerRef("account-terms", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    B. Account Terms
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> You&apos;re responsible
                      for your account security and activities under your
                      account.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. Account Creation:</strong> To use openloomi, you
                      must have a valid email account and authorize openloomi to
                      access your IM or email. You must provide accurate
                      information during setup.
                    </p>

                    <p>
                      <strong>2. Account Responsibility:</strong> You are
                      responsible for all activities conducted through your
                      openloomi account. You must maintain the security of your IM
                      or email credentials, as they control access to openloomi.
                    </p>

                    <p>
                      <strong>3. Eligibility:</strong> You must be at least{" "}
                      <strong>18 years old</strong>, or the age of legal
                      majority in your jurisdiction, whichever is higher, to use
                      openloomi. By using openloomi, you represent and warrant that
                      you meet this age requirement and have the legal capacity
                      to enter into this Agreement.
                    </p>

                    <p>
                      <strong>4. Account Limits:</strong> Individual users may
                      maintain one openloomi account. Organizations may have
                      multiple user accounts under a single organizational plan,
                      subject to plan limits.
                    </p>

                    <p>
                      <strong>5. Organizational Accounts:</strong> If you create
                      an account on behalf of an organization, you represent
                      that you have authority to bind that organization to these
                      terms.
                    </p>
                  </div>
                </section>

                {/* C. Acceptable Use */}
                <section
                  id="acceptable-use"
                  ref={(el) => registerRef("acceptable-use", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    C. Acceptable Use
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> Use openloomi in a way that
                      complies with laws and doesn&apos;t harm others or the
                      service.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. Permitted Use:</strong> You may use openloomi
                      only for lawful purposes and in accordance with this
                      Agreement.
                    </p>

                    <p>
                      <strong>2. Prohibited Activities:</strong> You agree not
                      to:
                    </p>
                    <ul>
                      <li>
                        Use openloomi to violate any law, regulation, or
                        third-party rights
                      </li>
                      <li>
                        Interfere with or disrupt the Service or its security
                      </li>
                      <li>Attempt to access unauthorized data or accounts</li>
                      <li>Use openloomi to send spam or unsolicited messages</li>
                      <li>
                        Reverse engineer, decompile, or attempt to extract
                        openloomi&apos; source code
                      </li>
                      <li>
                        Use openloomi in a way that could damage, disable, or
                        overburden the Service
                      </li>
                      <li>
                        Use AI features to generate harmful, illegal, or
                        misleading content
                      </li>
                      <li>
                        Attempt to bypass AI processing restrictions or opt-out
                        settings
                      </li>
                      <li>
                        Use the Service to collect data from third-party
                        platforms beyond authorized permissions
                      </li>
                    </ul>
                  </div>
                </section>

                {/* D. User-Generated Content */}
                <section
                  id="user-content"
                  ref={(el) => registerRef("user-content", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    D. User-Generated Content
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> You own your content, but
                      grant openloomi necessary rights to provide the service.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. Content Ownership:</strong> You retain all
                      rights to your Content in your IM or email. This Agreement
                      does not transfer ownership of your Content.
                    </p>

                    <p>
                      <strong>2. License Grant:</strong> You grant openloomi a
                      limited, non-exclusive license to access, process, and
                      display your IM or email content solely to provide the
                      Service, including:
                    </p>
                    <ul>
                      <li>
                        Analyzing messages to identify important information
                      </li>
                      <li>Generating summaries and notifications</li>
                      <li>Storing data temporarily to provide features</li>
                      <li>
                        Displaying relevant content within openloomi&apos;
                        interface
                      </li>
                    </ul>

                    <p>
                      <strong>3. Content Responsibility:</strong> You are solely
                      responsible for your Content and ensuring you have rights
                      to share it through openloomi.
                    </p>
                  </div>
                </section>

                {/* E. Data Privacy */}
                <section
                  id="data-privacy"
                  ref={(el) => registerRef("data-privacy", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    E. Data Privacy
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> openloomi treats your IM or
                      email data as confidential and only uses it to provide the
                      service. Raw messages stay on your device; only processed
                      summaries may be sent to the cloud.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. Data Access:</strong> openloomi accesses your IM
                      or email data only as necessary to provide features
                      you&apos;ve enabled, and in accordance with our Privacy
                      Policy.
                    </p>

                    <p>
                      <strong>2. On-Device Processing:</strong> Your original
                      messages and raw communication data are processed locally
                      on your device and are <strong>not uploaded</strong> to
                      our cloud servers. Only derived information—such as AI-
                      generated summaries, extracted action items, and smart
                      reply suggestions—may be transmitted to and stored on
                      openloomi cloud infrastructure for the purpose of delivering
                      the Service.
                    </p>

                    <p>
                      <strong>3. Data Security:</strong> openloomi implements
                      industry-standard technical and organizational measures to
                      protect your data, including:
                    </p>
                    <ul>
                      <li>
                        <strong>In Transit:</strong> All data transmitted
                        between your device and our servers is encrypted using
                        TLS/HTTPS.
                      </li>
                      <li>
                        <strong>At Rest:</strong> Data stored on our cloud
                        infrastructure is encrypted using AES-256 encryption.
                      </li>
                      <li>
                        <strong>Access Controls:</strong> We apply strict access
                        controls and authentication measures to limit internal
                        access to your data to authorized personnel only.
                      </li>
                    </ul>
                    <p>
                      For full details on our security practices, please refer
                      to the &quot;Data Security&quot; section of our{" "}
                      <a
                        href="/privacy"
                        className="text-purple-700 hover:underline"
                      >
                        Privacy Policy
                      </a>
                      .
                    </p>

                    <p>
                      <strong>4. Data Retention:</strong> openloomi retains your
                      IM or email data only for as long as necessary to provide
                      the Service or as required by law. You can request data
                      deletion by canceling your account.
                    </p>

                    <p>
                      <strong>5. Data Sharing:</strong> openloomi does not sell
                      your IM or email data to third parties. We may share data
                      with service providers who assist us in operating the
                      Service, subject to confidentiality obligations. We only
                      disclose user data when required by law or valid legal
                      process.
                    </p>

                    <p>
                      <strong>6. Third-Party Service Providers:</strong> To
                      deliver the Service, openloomi works with the following
                      categories of trusted third-party providers:
                    </p>
                    <ul>
                      <li>
                        <strong>Cloud Infrastructure – Vercel:</strong> We use
                        Vercel to host and serve the openloomi web application.
                        Vercel may process technical data (such as IP addresses
                        and request logs) as part of providing hosting services.
                      </li>
                      <li>
                        <strong>AI Model Provider – OpenRouter:</strong> We
                        route AI inference requests through OpenRouter to access
                        large language models for features such as message
                        summarization, smart reply suggestions, and action item
                        extraction. Processed (non-raw) content may be
                        transmitted to OpenRouter for this purpose.
                      </li>
                      <li>
                        <strong>Payment Processing – Stripe:</strong> Stripe
                        handles all subscription billing and payment
                        transactions. Stripe receives payment-related
                        information (such as billing details) as necessary to
                        process your subscription.
                      </li>
                      <li>
                        <strong>Database Infrastructure – Supabase:</strong> We
                        use Supabase to store and manage backend data, including
                        derived content such as AI-generated summaries and user
                        account information. Data stored via Supabase is
                        encrypted at rest using AES-256 encryption.
                      </li>
                    </ul>
                    <p>
                      Each of these providers is bound by data processing
                      agreements and applicable privacy regulations to protect
                      your information.
                    </p>

                    <p>
                      <strong>8. Data Breach Notification:</strong> In the event
                      of a data security breach that affects your personal
                      information, openloomi commits to notifying affected users
                      within <strong>72 hours</strong> of becoming aware of the
                      breach, where feasible. We will also report the breach to
                      relevant regulatory authorities as required by applicable
                      law and take prompt remediation measures to contain the
                      incident and prevent further unauthorized access. For full
                      details, please refer to our{" "}
                      <a
                        href="/privacy"
                        className="text-purple-700 hover:underline"
                      >
                        Privacy Policy
                      </a>
                      .
                    </p>

                    <p>
                      <strong>7. Cross-Border Data Transfers:</strong> Our
                      Service is currently primarily deployed in the United
                      States. If you are located outside the United States, your
                      data may be transferred to, stored in, or processed in the
                      United States or other countries where our service
                      providers operate. For users in the European Economic Area
                      (EEA) or other jurisdictions with data transfer
                      restrictions, such transfers are governed by Standard
                      Contractual Clauses (SCCs) or equivalent safeguards to
                      ensure your data is protected in accordance with
                      applicable law. For users in the{" "}
                      <strong>
                        European Economic Area (EEA), United Kingdom (UK)
                      </strong>
                      , or other jurisdictions with equivalent data protection
                      requirements, we rely on SCCs approved by the relevant
                      supervisory authorities.
                    </p>
                  </div>
                </section>

                {/* F. AI Features & Disclaimer */}
                <section
                  id="ai-features"
                  ref={(el) => registerRef("ai-features", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    F. AI Features &amp; Disclaimer
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> openloomi uses AI to help
                      you work smarter, but AI-generated content may not always
                      be accurate. Please review all AI output before acting on
                      it.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. AI-Powered Features:</strong> openloomi uses
                      artificial intelligence and large language models to
                      provide the following features, among others:
                    </p>
                    <ul>
                      <li>
                        <strong>Message summarization</strong> – automatically
                        condensing long conversations into concise summaries
                      </li>
                      <li>
                        <strong>Smart reply suggestions</strong> – generating
                        draft responses to messages based on context
                      </li>
                      <li>
                        <strong>Action item extraction</strong> – identifying
                        tasks and follow-up items from your communications
                      </li>
                      <li>
                        <strong>Operation execution suggestions</strong> –
                        recommending next steps or automated actions based on
                        message content
                      </li>
                      <li>
                        <strong>Cross-platform aggregation</strong> –
                        consolidating messages and notifications from multiple
                        platforms
                      </li>
                    </ul>

                    <p>
                      <strong>2. Disclaimer of AI Content:</strong> AI-generated
                      content is produced by automated systems and may contain
                      errors, omissions, biases, or inaccuracies.{" "}
                      <strong>
                        openloomi does not guarantee the accuracy, completeness,
                        reliability, or fitness for any particular purpose of
                        any AI-generated content.
                      </strong>{" "}
                      You are solely responsible for reviewing, verifying, and
                      exercising your own judgment before relying on or acting
                      upon any AI-generated output.
                    </p>

                    <p>
                      <strong>3. No Professional Advice:</strong> AI-generated
                      content does not constitute legal, financial, medical, or
                      other professional advice. You should consult qualified
                      professionals for advice specific to your situation.
                    </p>

                    <p>
                      <strong>4. No Responsibility for AI Output:</strong> To
                      the maximum extent permitted by applicable law, openloomi
                      assumes no liability for any decisions made, actions
                      taken, or consequences arising from your use of or
                      reliance on AI-generated content.
                    </p>
                  </div>
                </section>

                {/* G. Copyright Policy */}
                <section
                  id="copyright"
                  ref={(el) => registerRef("copyright", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    G. Copyright Policy
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> openloomi respects copyright
                      law and will respond to valid infringement claims.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      If you believe that content accessed through openloomi
                      infringes your copyright, please contact us with a
                      detailed notice containing the following:
                    </p>
                    <ol>
                      <li>
                        Identification of the copyrighted work you claim has
                        been infringed
                      </li>
                      <li>
                        Identification of the material that is claimed to be
                        infringing
                      </li>
                      <li>
                        Your contact information, including address, telephone
                        number, and email
                      </li>
                      <li>
                        A statement that you have a good faith belief that the
                        use is not authorized by the copyright owner
                      </li>
                      <li>
                        A statement that the information in the notice is
                        accurate, and under penalty of perjury, that you are
                        authorized to act on behalf of the copyright owner
                      </li>
                      <li>Your physical or electronic signature</li>
                    </ol>
                    <p>
                      openloomi will respond to valid notices by removing or
                      disabling access to the infringing material and may
                      terminate accounts of repeat infringers.
                    </p>
                  </div>
                </section>

                {/* H. Intellectual Property */}
                <section
                  id="intellectual-property"
                  ref={(el) => registerRef("intellectual-property", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    H. Intellectual Property
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> openloomi owns its service
                      and brand, while you retain rights to your content.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. openloomi Ownership:</strong> openloomi and its
                      licensors retain all intellectual property rights in the
                      Service, including but not limited to software, source
                      code, algorithms, machine learning models, trademarks,
                      logos, trade names, trade secrets, and any content or
                      materials created by openloomi. All rights not expressly
                      granted to you in this Agreement are reserved by openloomi.
                    </p>

                    <p>
                      <strong>2. Limited License to You:</strong> Subject to
                      your compliance with this Agreement, openloomi grants you a
                      limited, non-exclusive, non-transferable,
                      non-sublicensable, revocable license to access and use the
                      Service solely for your personal or internal business
                      purposes. This license does not include the right to:
                    </p>
                    <ul>
                      <li>
                        Copy, reproduce, distribute, or create derivative works
                        of the Service or any openloomi content
                      </li>
                      <li>
                        Reverse engineer, decompile, disassemble, or otherwise
                        attempt to extract the source code of the Service
                      </li>
                      <li>
                        Remove, obscure, or alter any proprietary notices,
                        labels, or marks on the Service
                      </li>
                      <li>
                        Use openloomi&apos; trademarks or brand assets without
                        prior written permission
                      </li>
                    </ul>

                    <p>
                      <strong>3. Feedback:</strong> If you provide openloomi with
                      any feedback, suggestions, or ideas regarding the Service
                      (&quot;Feedback&quot;), you grant openloomi a worldwide,
                      royalty-free, irrevocable, perpetual license to use, copy,
                      modify, and incorporate such Feedback into the Service
                      without any obligation to you.
                    </p>

                    <p>
                      <strong>4. Your Content:</strong> You retain all
                      intellectual property rights in your Content. Nothing in
                      this Agreement transfers ownership of your Content to
                      openloomi. The limited license you grant under §D.2 is
                      solely for the purpose of operating and improving the
                      Service.
                    </p>
                  </div>
                </section>

                {/* I. Fees and Payment */}
                <section
                  id="payment"
                  ref={(el) => registerRef("payment", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    I. Fees and Payment
                  </h2>
                  <ol className="space-y-6">
                    <li>
                      <strong>1. Subscription Plans and Fees</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          openloomi offers different subscription plans ({" "}
                          <strong>Trial, Basic, Pro, and Team plans</strong>
                          ).
                        </li>
                        <li>
                          Details regarding features, pricing, and limitations
                          are provided on the official website or subscription
                          page.
                        </li>
                        <li>
                          Users must review and confirm the applicable price,
                          billing cycle, and usage limits when selecting a
                          subscription plan.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>2. Payment Method</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          All payments are processed via <strong>Stripe</strong>
                          , a third-party payment service provider.
                        </li>
                        <li>
                          Users must provide valid payment information and
                          ensure it remains accurate, complete, and up to date.
                        </li>
                        <li>
                          By submitting payment, the user authorizes openloomi to
                          charge the applicable fees via Stripe for each billing
                          cycle.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>3. Automatic Renewal</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          Unless canceled before the end of the current billing
                          cycle, all subscriptions will{" "}
                          <strong>automatically renew</strong> and fees will be
                          charged to the registered payment method.
                        </li>
                        <li>
                          Users may manage or cancel their subscription at any
                          time in the account settings.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>4. Free Trial and Usage Limits</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          openloomi may offer a <strong>free trial</strong> or
                          limited free usage for new users.
                        </li>
                        <li>
                          Once the trial period or free quota ends, the user
                          will no longer be able to access the full
                          functionality unless they upgrade to a paid
                          subscription plan.
                        </li>
                        <li>
                          Free trials{" "}
                          <strong>do not automatically convert</strong> into
                          paid subscriptions unless the user explicitly upgrades
                          and completes payment.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>5. Upgrades and Downgrades</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          Users may <strong>upgrade</strong> their subscription
                          at any time. Upgrade fees will be prorated based on
                          the remaining billing cycle.
                        </li>
                        <li>
                          Subscription <strong>downgrades</strong> will take
                          effect in the next billing cycle. No refunds or
                          credits will be issued for the current cycle.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>6. Refund Policy</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          All fees are <strong>non-refundable</strong> once
                          paid, except as otherwise required by applicable law
                          in your jurisdiction or as explicitly promised by
                          openloomi.
                        </li>
                        <li>
                          If the service experiences a major outage or becomes
                          unavailable, users may contact openloomi Support for
                          case-by-case resolution.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>7. Price Adjustments</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          openloomi reserves the right to adjust subscription
                          prices and features at any time.
                        </li>
                        <li>
                          Price changes will take effect in the{" "}
                          <strong>next billing cycle</strong>, and users will be
                          notified in advance within a reasonable timeframe.
                        </li>
                        <li>
                          If the user does not agree to the adjustments, they
                          may cancel their subscription before the new billing
                          cycle begins.
                        </li>
                      </ul>
                    </li>
                    <li>
                      <strong>8. Taxes</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-1 prose prose-gray max-w-none">
                        <li>
                          Subscription fees may not include applicable taxes.
                        </li>
                        <li>
                          Users are responsible for any taxes required by local
                          laws and regulations.
                        </li>
                      </ul>
                    </li>
                  </ol>
                </section>

                {/* J. Limitation of Liability */}
                <section
                  id="liability"
                  ref={(el) => registerRef("liability", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    J. Limitation of Liability
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> openloomi&apos; liability
                      for direct damages is capped at the subscription fees you
                      paid. openloomi is not liable for indirect or consequential
                      losses.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. Cap on Direct Damages:</strong> To the maximum
                      extent permitted by applicable law, openloomi&apos; total
                      cumulative liability to you for any direct damages arising
                      out of or related to this Agreement or the Service shall
                      not exceed the{" "}
                      <strong>
                        total subscription fees paid by you to openloomi in the
                        twelve (12) months immediately preceding the event
                        giving rise to the claim
                      </strong>
                      .
                    </p>

                    <p>
                      <strong>2. Exclusion of Indirect Damages:</strong> To the
                      maximum extent permitted by applicable law, openloomi shall
                      not be liable for any indirect, incidental, special,
                      consequential, punitive, or exemplary damages, including
                      but not limited to loss of profits, loss of data, loss of
                      goodwill, business interruption, or cost of substitute
                      services, even if openloomi has been advised of the
                      possibility of such damages.
                    </p>

                    <p>
                      <strong>3. AI-Generated Content:</strong> openloomi assumes
                      no liability for any loss or damage arising from your use
                      of or reliance on AI-generated content, including
                      summaries, smart reply suggestions, action item
                      extractions, or operation execution recommendations. All
                      AI-generated output is provided &quot;as is&quot; without
                      any warranty of accuracy, completeness, reliability, or
                      fitness for a particular purpose. You are solely
                      responsible for independently verifying AI-generated
                      content before acting upon it.
                    </p>

                    <p>
                      <strong>4. Service Availability:</strong> openloomi does not
                      warrant that the Service will be uninterrupted,
                      error-free, or free from harmful components. The Service
                      is provided on an &quot;as is&quot; and &quot;as
                      available&quot; basis.
                    </p>

                    <p>
                      <strong>5. Jurisdictional Variations:</strong> Some
                      jurisdictions do not allow the exclusion or limitation of
                      certain warranties or liabilities. In such cases, the
                      above limitations apply to the fullest extent permitted by
                      law in your jurisdiction.
                    </p>
                  </div>
                </section>

                {/* K. Restricted Regions */}
                <section
                  id="restricted-regions"
                  ref={(el) => registerRef("restricted-regions", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    K. Restricted Regions
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> The Service is not
                      available in certain regions. By using the Service, you
                      confirm you are not located in a restricted area.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. PRC Restriction:</strong> The Service is not
                      offered to individuals or entities located within the
                      People&apos;s Republic of China (&quot;PRC&quot;). By
                      accessing or using the Service, you represent and warrant
                      that you are not located in, and are not a resident of,
                      the PRC.
                    </p>

                    <p>
                      <strong>2. Right to Restrict:</strong> openloomi reserves
                      the right, at its sole discretion and at any time, to
                      restrict or discontinue the availability of the Service or
                      any portion thereof to any individual, geographic region,
                      or jurisdiction.
                    </p>

                    <p>
                      <strong>3. Compliance with Local Laws:</strong> It is your
                      responsibility to ensure that your use of the Service
                      complies with all applicable local laws and regulations in
                      your jurisdiction.
                    </p>
                  </div>
                </section>

                {/* L. Governing Law & Arbitration */}
                <section
                  id="governing-law"
                  ref={(el) => registerRef("governing-law", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    L. Governing Law &amp; Arbitration
                  </h2>
                  <div className="bg-gray-50 p-4 rounded-md mb-6">
                    <p className="text-sm font-medium text-gray-700">
                      <strong>Short version:</strong> This Agreement is governed
                      by Singapore law, and disputes are resolved by SIAC
                      arbitration.
                    </p>
                  </div>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      This Agreement shall be governed by and construed in
                      accordance with the laws of Singapore. Any dispute arising
                      out of or in connection with this Agreement shall be
                      referred to and finally resolved by arbitration in
                      Singapore administered by the Singapore International
                      Arbitration Centre (&quot;SIAC&quot;) in accordance with
                      the Arbitration Rules of the SIAC for the time being in
                      force. The number of arbitrators shall be one (1) and the
                      language of the arbitration shall be English. Any decision
                      or award as a result of such arbitration proceedings shall
                      be final and binding on both parties.
                    </p>
                  </div>
                </section>

                {/* M. Miscellaneous */}
                <section
                  id="miscellaneous"
                  ref={(el) => registerRef("miscellaneous", el)}
                  className="mb-12"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">
                    M. Miscellaneous
                  </h2>
                  <div className="prose prose-gray max-w-none">
                    <p>
                      <strong>1. Entire Agreement:</strong> This Agreement,
                      together with our Privacy Policy, constitutes the entire
                      agreement between you and openloomi regarding the Service
                      and supersedes all prior agreements and understandings.
                    </p>

                    <p>
                      <strong>2. Severability:</strong> If any provision of this
                      Agreement is found to be unenforceable or invalid, that
                      provision will be limited or eliminated to the minimum
                      extent necessary, and the remaining provisions will
                      continue in full force and effect.
                    </p>

                    <p>
                      <strong>3. Waiver:</strong> openloomi&apos; failure to
                      enforce any right or provision of this Agreement will not
                      be considered a waiver of those rights.
                    </p>

                    <p>
                      <strong>4. Assignment:</strong> You may not assign or
                      transfer this Agreement without openloomi&apos; prior
                      written consent. openloomi may assign this Agreement without
                      restriction.
                    </p>

                    <p>
                      <strong>5. Amendments:</strong> openloomi reserves the right
                      to modify these Terms at any time. We will notify you of
                      material changes via email or prominent notice on the
                      Service. Your continued use of the Service after such
                      notice constitutes your acceptance of the updated Terms.
                    </p>

                    <p>
                      <strong>6. Force Majeure:</strong> openloomi shall not be
                      liable for any delay or failure in performance resulting
                      from causes beyond its reasonable control, including but
                      not limited to acts of God, war, terrorism, government
                      action, or internet service disruptions.
                    </p>
                  </div>
                </section>

                <div className="border-t border-gray-200 pt-8 mt-12">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Help and Support
                  </h3>
                  <p className="text-gray-600 mb-4">
                    If you have questions about these Terms of Service, please
                    contact us.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <Link
                      href="/"
                      className="text-purple-700 hover:text-purple-800 hover:underline"
                    >
                      Home
                    </Link>
                    <Link
                      href="/privacy"
                      className="text-purple-700 hover:text-purple-800 hover:underline"
                    >
                      Privacy Policy
                    </Link>
                    <button
                      type="button"
                      onClick={() => openUrl("https://openloomi.ai/docs")}
                      className="text-purple-700 hover:text-purple-800 hover:underline"
                    >
                      Help
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

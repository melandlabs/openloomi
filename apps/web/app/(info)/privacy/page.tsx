"use client";

import React, { useState, useEffect } from "react";
import Head from "next/head";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaFileAlt,
  FaChevronDown,
  FaChevronUp,
  FaUserShield,
  FaCookie,
  FaClock,
  FaChild,
  FaEdit,
  FaEnvelope,
  FaShieldAlt,
  FaGlobe,
  FaExchangeAlt,
} from "react-icons/fa";
import { openUrl } from "@/lib/tauri";

// Define type for expanded sections state
type ExpandedSections = {
  collection: boolean;
  use: boolean;
  storage: boolean;
  dataSecurity: boolean;
  dataTransfer: boolean;
  cookies: boolean;
  rights: boolean;
  retention: boolean;
  disclosure: boolean;
  minors: boolean;
  changes: boolean;
  contact: boolean;
};

// Define type for section keys
type SectionKey = keyof ExpandedSections;

export default function PrivacyPolicy() {
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    collection: false,
    use: false,
    storage: false,
    dataSecurity: false,
    dataTransfer: false,
    cookies: false,
    rights: false,
    retention: false,
    disclosure: false,
    minors: false,
    changes: false,
    contact: false,
  });

  const [isScrolled, setIsScrolled] = useState(false);

  // Handle scroll events for navbar styling
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Toggle section expansion with proper type annotations
  const toggleSection = (section: SectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Section animation variants
  const sectionVariants = {
    collapsed: { height: 0, opacity: 0, overflow: "hidden" },
    expanded: {
      height: "auto",
      opacity: 1,
      transition: {
        duration: 0.3,
        ease: "easeInOut",
      },
    },
  };

  return (
    <>
      <Head>
        <title>Privacy Policy | openloomi</title>
        <meta
          name="description"
          content="openloomi Privacy Policy - Learn how we collect, use, and protect your data"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-6 pt-32 pb-20">
        {/* Page Title */}
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-4xl md:text-5xl font-bold text-gray-900 mb-6"
          >
            openloomi Privacy Policy
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-lg text-gray-600"
          >
            We value your privacy and data security. This Privacy Policy
            explains how we collect, use, store, and protect your personal
            information.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm text-gray-500 mt-4"
          >
            Last Updated: March 3, 2026
          </motion.p>
        </div>

        {/* Privacy Policy Content */}
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Introduction */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-white rounded-xl shadow-sm p-6 border border-gray-100"
          >
            <p className="text-gray-700 leading-relaxed">
              Welcome to{" "}
              <strong>openloomi Cross-Platform Communication Agent</strong>{" "}
              (&quot;openloomi&quot;, &quot;we&quot;, &quot;our&quot;, or
              &quot;us&quot;).
            </p>
            <p className="text-gray-700 leading-relaxed mt-3">
              We value your privacy and data security. This Privacy Policy
              explains how we collect, use, store, and protect your personal
              information, as well as your rights when using openloomi.
            </p>
            <p className="text-gray-700 leading-relaxed mt-3">
              By accessing or using the Service, you acknowledge that you have
              read, understood, and agree to be bound by this Privacy Policy.
            </p>
          </motion.section>

          {/* Information We Collect */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("collection")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <FaFileAlt size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Information We Collect
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.collection ? (
                  <FaChevronUp />
                ) : (
                  <FaChevronDown />
                )}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.collection ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-6">
                  <div>
                    <h3 className="font-medium text-gray-800 mb-2">
                      Account Information
                    </h3>
                    <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-1">
                      <li>
                        Email, username, or third-party login credentials (e.g.,
                        Slack, Discord, Telegram)
                      </li>
                      <li>
                        Basic identity information for account verification
                      </li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-800 mb-2">
                      Messages and Communication Data
                    </h3>
                    <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-1">
                      <li>
                        Upon your authorization, we may access and process your
                        communication data from platforms such as Slack,
                        Discord, and Telegram to enable message aggregation,
                        summarization, and notifications.
                      </li>
                      <li>
                        <strong>
                          Your original messages and raw communication data
                          remain on your device and are not uploaded to our
                          cloud.
                        </strong>{" "}
                        openloomi processes raw content locally and may upload
                        only derived information—such as AI-generated summaries,
                        extracted action items, and smart reply suggestions—to
                        our cloud infrastructure to deliver the Service.
                      </li>
                      <li>
                        We will never use your communication content for
                        unrelated purposes without your explicit consent.
                      </li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-800 mb-2">
                      Device and Technical Data
                    </h3>
                    <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-1">
                      <li>
                        Device type, browser, operating system, IP address
                      </li>
                      <li>
                        Cookies and local storage data to maintain login
                        sessions and improve user experience
                      </li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-800 mb-2">
                      Usage Data
                    </h3>
                    <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-1">
                      <li>
                        Records of feature usage (e.g., number of summaries,
                        conversations, external tool integrations)
                      </li>
                      <li>Notification and delivery preference settings</li>
                    </ul>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* How We Use Your Information */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("use")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                  <FaUserShield size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  How We Use Your Information
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.use ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.use ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    We use the collected information for the following purposes:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      To provide and improve openloomi&apos; core features
                      (message aggregation, summarization, notifications,
                      conversations)
                    </li>
                    <li>
                      To deliver information according to your preferences
                    </li>
                    <li>
                      To ensure service security and stability (monitoring
                      suspicious behavior, preventing misuse)
                    </li>
                    <li>
                      To conduct anonymized statistical analysis for product
                      optimization
                    </li>
                    <li>
                      To provide product updates and service-related
                      notifications with your consent
                    </li>
                  </ul>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Data Storage and Security */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("storage")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                  <FaShieldAlt size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Data Storage and Third-Party Sharing
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.storage ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.storage ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>
                        Original chat records and emails exist only on your
                        device and are not uploaded to our cloud.
                      </strong>{" "}
                      Only processed summaries and derived metadata (such as
                      AI-generated summaries and smart reply suggestions) may be
                      stored in the cloud to deliver the Service. For details on
                      encryption and security measures applied to this stored
                      data, see the <strong>Data Security</strong> section
                      below.
                    </li>
                    <li>
                      Your communication data is only stored for the required
                      processing period, after which it will be automatically
                      deleted or anonymized.
                    </li>
                    <li>
                      We will not sell your personal information to third
                      parties.
                    </li>
                    <li>
                      We only disclose user data when required by applicable law
                      or valid legal process.
                    </li>
                  </ul>

                  <p className="text-gray-700 font-medium mt-4">
                    Third-Party Service Providers
                  </p>
                  <p className="text-gray-600 leading-relaxed text-sm">
                    To deliver the Service, we share limited data with the
                    following trusted third-party providers:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>Vercel (Cloud Infrastructure):</strong> We use
                      Vercel to host and serve the openloomi web application.
                      Vercel may process technical data (such as IP addresses
                      and request logs) as part of providing hosting services.
                    </li>
                    <li>
                      <strong>OpenRouter (AI Model Provider):</strong> We route
                      AI inference requests through OpenRouter to access large
                      language models for features such as message
                      summarization, smart reply suggestions, and action item
                      extraction. Processed (non-raw) content may be transmitted
                      to OpenRouter for this purpose.
                    </li>
                    <li>
                      <strong>Stripe (Payment Processing):</strong> Stripe
                      handles all subscription billing and payment transactions.
                      Stripe receives payment-related information (such as
                      billing details) as necessary to process your
                      subscription. Stripe&apos;s privacy practices are governed
                      by its own privacy policy.
                    </li>
                  </ul>
                  <p className="text-gray-600 leading-relaxed text-sm">
                    Each provider is bound by data processing agreements and
                    applicable privacy regulations.
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Data Security */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("dataSecurity")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                  <FaShieldAlt size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Data Security
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.dataSecurity ? (
                  <FaChevronUp />
                ) : (
                  <FaChevronDown />
                )}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={
                  expandedSections.dataSecurity ? "expanded" : "collapsed"
                }
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    We implement industry-standard security measures to protect
                    your data:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>In Transit:</strong> All data transmitted between
                      your device and our servers is encrypted using TLS/HTTPS.
                    </li>
                    <li>
                      <strong>At Rest:</strong> Data stored on our cloud
                      infrastructure is encrypted with AES-256 encryption.
                    </li>
                    <li>
                      <strong>Access Controls:</strong> We apply strict access
                      controls and authentication measures to limit internal
                      access to your data to authorized personnel only.
                    </li>
                    <li>
                      <strong>In Use:</strong> Raw message content is processed
                      locally on your device wherever possible; only derived
                      outputs are transmitted to the cloud.
                    </li>
                  </ul>
                  <p className="text-gray-700 font-medium mt-4">
                    Data Breach Notification
                  </p>
                  <p className="text-gray-600 leading-relaxed">
                    In the event of a data breach that affects your personal
                    information, we commit to:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      Notifying affected users within <strong>72 hours</strong>{" "}
                      of becoming aware of the breach, where feasible.
                    </li>
                    <li>
                      Reporting the breach to relevant regulatory authorities as
                      required by applicable law (e.g., GDPR supervisory
                      authorities).
                    </li>
                    <li>
                      Taking prompt remediation measures to contain the breach
                      and prevent further unauthorized access.
                    </li>
                  </ul>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Cross-Border Data Transfers */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("dataTransfer")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                  <FaGlobe size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Cross-Border Data Transfers
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.dataTransfer ? (
                  <FaChevronUp />
                ) : (
                  <FaChevronDown />
                )}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={
                  expandedSections.dataTransfer ? "expanded" : "collapsed"
                }
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    Our Service is currently primarily deployed in the{" "}
                    <strong>United States</strong>. If you are located outside
                    the United States, please be aware that your data may be
                    transferred to, stored in, or processed in the United States
                    or other countries where our service providers operate.
                  </p>
                  <p className="text-gray-600 leading-relaxed">
                    These countries may have different data protection laws than
                    your country of residence. To protect your data during
                    cross-border transfers, we rely on appropriate safeguards,
                    including:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>Standard Contractual Clauses (SCCs)</strong>{" "}
                      approved by the European Commission for transfers from the
                      EEA, UK, or other jurisdictions with equivalent
                      requirements.
                    </li>
                    <li>
                      Data processing agreements with our third-party service
                      providers that impose obligations consistent with
                      applicable data protection law.
                    </li>
                  </ul>
                  <p className="text-gray-600 leading-relaxed">
                    By using the Service, you acknowledge and consent to the
                    transfer of your data as described above.
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Cookies */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("cookies")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600">
                  <FaCookie size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">Cookies</h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.cookies ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.cookies ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    We use cookies for the following purposes:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>Strictly Necessary Cookies</strong>: To maintain
                      login sessions and perform authentication (do not require
                      additional consent)
                    </li>
                    <li>
                      <strong>Preference Cookies</strong>: To save user
                      notification and interface settings
                    </li>
                    <li>
                      <strong>Performance and Analytics Cookies</strong>: To
                      track visits and usage behavior in order to improve the
                      product experience (require user consent)
                    </li>
                  </ul>
                  <p className="text-gray-600 leading-relaxed mt-3">
                    You can clear or disable cookies at any time in your
                    browser, though some features may not work properly.
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Your Rights */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("rights")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                  <FaUserShield size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Your Rights
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.rights ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.rights ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    You have the following rights regarding your personal
                    information:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>Right of Access</strong> – You may request access
                      to the information we hold about you
                    </li>
                    <li>
                      <strong>Right of Rectification</strong> – You may correct
                      inaccurate or incomplete information
                    </li>
                    <li>
                      <strong>Right of Erasure</strong> – You may request the
                      deletion of your personal data
                    </li>
                    <li>
                      <strong>Right to Restrict Processing</strong> – You may
                      limit how your data is processed in specific cases
                    </li>
                    <li>
                      <strong>Right to Data Portability</strong> – You may
                      export and transfer your data
                    </li>
                    <li>
                      <strong>Right to Withdraw Consent</strong> – You may
                      withdraw your consent to data collection and processing at
                      any time
                    </li>
                  </ul>
                  <p className="text-gray-600 leading-relaxed text-sm mt-2">
                    To exercise any of these rights, please contact us at{" "}
                    <a
                      href="mailto:support@melandlabs.ai"
                      className="text-blue-600 hover:underline"
                    >
                      support@melandlabs.ai
                    </a>
                    .
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Data Retention */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("retention")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                  <FaClock size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Data Retention
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.retention ? (
                  <FaChevronUp />
                ) : (
                  <FaChevronDown />
                )}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.retention ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      Communication data: Retained for <strong>7 days</strong>{" "}
                      by default, used only for summarization and conversation
                      purposes
                    </li>
                    <li>
                      Account information: Deleted within{" "}
                      <strong>30 days</strong> after account deletion
                    </li>
                    <li>
                      Usage statistics and logs: May be retained in anonymized
                      form for security and research purposes
                    </li>
                  </ul>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Legal Disclosure */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("disclosure")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                  <FaExchangeAlt size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Legal Disclosure
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.disclosure ? (
                  <FaChevronUp />
                ) : (
                  <FaChevronDown />
                )}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.disclosure ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    We will only disclose your personal data to third parties in
                    the following limited circumstances:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>Legal Requirement:</strong> When we are required
                      to do so by applicable law, court order, or other valid
                      legal process.
                    </li>
                    <li>
                      <strong>Protection of Rights:</strong> When necessary to
                      protect the rights, property, or safety of openloomi, our
                      users, or the public.
                    </li>
                    <li>
                      <strong>Business Transfers:</strong> In connection with a
                      merger, acquisition, or sale of assets, subject to the
                      acquirer maintaining equivalent privacy protections.
                    </li>
                  </ul>
                  <p className="text-gray-600 leading-relaxed text-sm">
                    We will not sell your personal information to third parties
                    for marketing or advertising purposes.
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Protection of Minors */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("minors")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-600">
                  <FaChild size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Protection of Minors
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.minors ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.minors ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    openloomi services are intended for users aged{" "}
                    <strong>18 and above</strong>, or the age of legal majority
                    in your jurisdiction, whichever is higher. If you are under
                    the applicable age of majority, you may not use openloomi
                    without verified parental or guardian consent and
                    supervision.
                  </p>
                  <p className="text-gray-600 leading-relaxed">
                    If we become aware that we have inadvertently collected
                    personal information from a minor without appropriate
                    consent, we will take steps to delete such information
                    promptly.
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Policy Updates */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("changes")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-600">
                  <FaEdit size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Policy Updates
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.changes ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.changes ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    We may update this Privacy Policy to comply with laws,
                    regulations, or service changes. Updates will be announced
                    on our website or via email. For significant changes, we
                    will seek your explicit consent.
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Contact Us */}
          <section className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <button
              type="button"
              className="p-6 cursor-pointer flex justify-between items-center w-full text-left"
              onClick={() => toggleSection("contact")}
            >
              <div className="flex items-center space-x-3">
                <div className="size-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                  <FaEnvelope size={20} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">
                  Contact Us
                </h2>
              </div>
              <div className="text-gray-500">
                {expandedSections.contact ? <FaChevronUp /> : <FaChevronDown />}
              </div>
            </button>

            <AnimatePresence>
              <motion.div
                variants={sectionVariants}
                initial="collapsed"
                animate={expandedSections.contact ? "expanded" : "collapsed"}
                className="px-6 pb-6"
              >
                <div className="pl-13 space-y-4">
                  <p className="text-gray-600 leading-relaxed">
                    If you have any questions about this Privacy Policy or how
                    your data is processed, please contact us at:
                  </p>
                  <ul className="text-gray-600 leading-relaxed list-disc pl-5 space-y-2">
                    <li>
                      <strong>Discord</strong>:{" "}
                      <button
                        type="button"
                        onClick={() => openUrl("https://discord.gg/xkJaJyWcsv")}
                        className="text-blue-600 hover:underline"
                      >
                        Join the group
                      </button>
                    </li>
                    <li>
                      <strong>Email</strong>:{" "}
                      <a
                        href="mailto:support@melandlabs.ai"
                        className="text-blue-600 hover:underline"
                      >
                        support@melandlabs.ai
                      </a>
                    </li>
                  </ul>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* Compliance Statement */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-indigo-50 rounded-xl p-6 border border-indigo-100 mt-8"
          >
            <h2 className="text-xl font-semibold text-indigo-800 mb-3">
              Compliance Statement
            </h2>
            <p className="text-indigo-700 leading-relaxed">
              openloomi is committed to complying with applicable data protection
              regulations, including but not limited to the GDPR (General Data
              Protection Regulation) and the Personal Data Protection Act (PDPA)
              of Singapore. Our privacy practices are designed to protect your
              personal data and ensure your privacy rights are respected. This
              Privacy Policy is governed by the laws of Singapore.
            </p>
            <p className="text-indigo-700 leading-relaxed mt-3">
              Any disputes arising out of or in connection with this Privacy
              Policy shall be resolved in accordance with the dispute resolution
              and arbitration provisions set forth in the{" "}
              <a
                href="/terms"
                className="text-indigo-900 font-medium hover:underline"
              >
                openloomi Terms of Service
              </a>
              , which provides for binding arbitration in Singapore administered
              by the Singapore International Arbitration Centre (SIAC).
            </p>
          </motion.section>
        </div>
      </main>
    </>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  FaQuestionCircle,
  FaSearch,
  FaFileAlt,
  FaCheckCircle,
  FaChevronDown,
  FaChevronUp,
} from "react-icons/fa";
import { openUrl } from "@/lib/tauri";

// Define FAQ item type
type FAQItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
};

// Define expanded FAQs state type
type ExpandedFAQs = {
  [key: string]: boolean;
};

// Define category type
type Category =
  | "account"
  | "features"
  | "integrations"
  | "billing"
  | "security";

export default function SupportPage() {
  // Fixed typo: expandededFAQs → expandedFAQs
  const [expandedFAQs, setExpandedFAQs] = useState<ExpandedFAQs>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [isScrolled, setIsScrolled] = useState(false);

  // Handle scroll events for navbar styling
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // FAQ data
  const faqItems: FAQItem[] = [
    {
      id: "1",
      question: "How do I create a openloomi account?",
      answer:
        'Creating a openloomi account is simple. Click the "Sign Up" button in the top right corner of the website, fill in your name, email address, and create a password. After completing registration, you will receive a verification email. Please click the link in the email to verify your account. Once verified, you can start using all openloomi features.',
      category: "account",
    },
    {
      id: "2",
      question: "I forgot my password. How do I reset it?",
      answer:
        'If you forgot your password, please click the "Forgot Password" link on the login page. Enter the email address you used to register, and we will send a password reset link to your email. After clicking the link, you can set a new password. Please note that the password reset link is valid for 1 hour.',
      category: "account",
    },
    {
      id: "3",
      question: "Which third-party platforms does openloomi integrate with?",
      answer:
        'Currently, openloomi supports integration with Slack, Telegram, Discord, Gmail, Outlook, Microsoft Teams, WhatsApp, and Facebook Messenger. We are constantly expanding our supported platforms, so stay tuned for future updates. You can manage your integrations in the "Settings > Integrations" page.',
      category: "integrations",
    },
    {
      id: "4",
      question: "How do I change my subscription plan?",
      answer:
        'You can change your subscription plan at any time in the "Account Settings > Subscription" page. Plan upgrades take effect immediately, while downgrades take effect at the end of the current billing cycle. All plan changes will be notified to you via email, and you can view details in "Billing History".',
      category: "billing",
    },
    {
      id: "5",
      question: "How does openloomi ensure my data security?",
      answer:
        "openloomi uses multiple security measures to protect your data, including end-to-end encryption, regular security audits, two-factor authentication, and data backups. We follow industry best practices and privacy regulations and will not sell your data to third parties. You can learn more about data security in our privacy policy.",
      category: "security",
    },
    {
      id: "6",
      question: "How do I use openloomi's intelligent aggregation feature?",
      answer:
        "Intelligent aggregation is openloomi's core feature. Once you connect your integration accounts, openloomi automatically collects and organizes all your messages. You can use the filters on the dashboard to filter by integration, importance, date, or keywords. The system also automatically identifies important messages and displays them at the top to help you prioritize critical information.",
      category: "features",
    },
    {
      id: "7",
      question: "Can I customize notification settings?",
      answer:
        'Yes, you can fully customize your notification settings. On the "Settings > Notifications" page, you can choose how you want to receive notifications (email, in-app notifications, or SMS), notification frequency, and the types of events you want to be notified about. You can also set different notification preferences for different platforms.',
      category: "features",
    },
    {
      id: "8",
      question: "How do I cancel my subscription?",
      answer:
        'You can cancel your subscription in the "Account Settings > Subscription" page. After cancellation, you can still use all features of your current plan until the end of the current billing cycle. We will not automatically renew a canceled subscription, but you can reactivate your subscription at any time. If you have any questions or feedback about canceling your subscription, please contact our support team.',
      category: "billing",
    },
  ];

  // Toggle FAQ expansion state
  const toggleFAQ = (id: string) => {
    setExpandedFAQs((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Filter FAQ items
  const filteredFAQs = faqItems.filter((item) => {
    const matchesSearch =
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      activeCategory === "all" || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Animation variants
  const sectionVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const faqVariants = {
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
        <title>Support Center | openloomi</title>
        <meta
          name="description"
          content="openloomi Support Center - Get help with any issues you encounter"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-6 pt-32 pb-20">
        {/* Page Title */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={sectionVariants}
          className="text-center mb-16 max-w-3xl mx-auto"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            openloomi Support Center
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            We&apos;re here to help with any issues you may encounter while
            using openloomi. Browse our frequently asked questions or contact
            our support team.
          </p>

          {/* Search Box */}
          <div className="relative max-w-xl mx-auto">
            <input
              type="text"
              placeholder="Search for questions or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            />
            <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
        </motion.div>

        {/* Frequently Asked Questions */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={sectionVariants}
          transition={{ delay: 0.2 }}
          className="max-w-3xl mx-auto"
        >
          <h2 className="text-3xl font-bold text-foreground mb-8 text-center">
            Frequently Asked Questions
          </h2>

          {/* Category Filters */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All Questions
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("account")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === "account"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Account
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("features")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === "features"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("integrations")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === "integrations"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Integrations
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("billing")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === "billing"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Billing
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("security")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                activeCategory === "security"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Security
            </button>
          </div>

          {/* No search results display */}
          {filteredFAQs.length === 0 && (
            <div className="text-center py-12 bg-muted rounded-xl border border-border">
              <FaQuestionCircle
                size={48}
                className="text-muted-foreground/50 mx-auto mb-4"
              />
              <h3 className="text-xl font-medium text-foreground mb-2">
                No related questions found
              </h3>
              <p className="text-muted-foreground mb-6">
                Try searching with different keywords or contact our support
                team.
              </p>
              <Link
                href="/support/ticket"
                className="inline-flex items-center px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Submit Support Request{" "}
                <FaChevronDown size={16} className="ml-2" />
              </Link>
            </div>
          )}

          {/* FAQ List */}
          <div className="space-y-4">
            {filteredFAQs.map((item, index) => (
              <motion.section
                key={item.id}
                initial="hidden"
                animate="visible"
                variants={sectionVariants}
                transition={{ delay: 0.3 + index * 0.05 }}
                className="bg-card rounded-xl shadow-sm overflow-hidden border border-border"
              >
                <div
                  role="button"
                  className="p-6 cursor-pointer flex justify-between items-center"
                  onClick={() => toggleFAQ(item.id)}
                >
                  <h3 className="text-lg font-medium text-foreground">
                    {item.question}
                  </h3>
                  <div className="text-muted-foreground">
                    {expandedFAQs[item.id] ? (
                      <FaChevronUp />
                    ) : (
                      <FaChevronDown />
                    )}
                  </div>
                </div>

                <AnimatePresence>
                  <motion.div
                    variants={faqVariants}
                    initial="collapsed"
                    animate={expandedFAQs[item.id] ? "expanded" : "collapsed"}
                    className="px-6 pb-6"
                  >
                    <p className="text-muted-foreground leading-relaxed">
                      {item.answer}
                    </p>
                    <div className="mt-4 pt-4 border-t border-border">
                      <p className="text-sm text-muted-foreground flex items-center">
                        <FaCheckCircle
                          size={16}
                          className="mr-2 text-green-500"
                        />
                        Did this answer solve your problem?
                      </p>
                      <div className="flex space-x-4 mt-2">
                        <button
                          type="button"
                          className="text-sm text-green-600 hover:text-green-700 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-600 hover:text-red-700 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </motion.section>
            ))}
          </div>
        </motion.div>

        {/* Help Resources */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={sectionVariants}
          transition={{ delay: 0.4 }}
          className="max-w-4xl mx-auto mt-16"
        >
          <h2 className="text-3xl font-bold text-foreground mb-8 text-center">
            Help Resources
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              type="button"
              onClick={() => openUrl("https://openloomi.ai/docs")}
              className="block group text-left w-full"
            >
              <div className="bg-card h-full p-6 rounded-xl shadow-sm border border-border hover:shadow-md transition-all group-hover:border-primary/30">
                <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FaFileAlt size={24} />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                  Official Documentation
                </h3>
                <p className="text-muted-foreground">
                  Detailed feature explanations, API references, and usage
                  guides to help you make the most of all openloomi features.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                openUrl("https://www.youtube.com/watch?v=LDtJ6vfbob")
              }
              className="block group text-left w-full"
            >
              <div className="bg-card h-full p-6 rounded-xl shadow-sm border border-border hover:shadow-md transition-all group-hover:border-primary/30">
                <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FaFileAlt size={24} />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                  Video Tutorials
                </h3>
                <p className="text-muted-foreground">
                  Step-by-step video tutorials covering basic operations to
                  advanced techniques for mastering openloomi.
                </p>
              </div>
            </button>
          </div>
        </motion.div>
      </main>
    </>
  );
}

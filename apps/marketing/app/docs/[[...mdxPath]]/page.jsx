/* eslint-disable react-hooks/rules-of-hooks -- false positive, useMDXComponents isn't react hooks */

import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents } from "../../../mdx-components";

export const generateStaticParams = generateStaticParamsFor("mdxPath");

/**
 * Generate page metadata
 */
export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const { metadata } = await importPage(resolvedParams.mdxPath);
  return metadata;
}

const Wrapper = useMDXComponents().wrapper;

/**
 * Docs page component
 * Layout already provides ConfigContext, only need to use Wrapper here
 */
export default async function Page({ params }) {
  const resolvedParams = await params;
  const result = await importPage(resolvedParams.mdxPath);
  const { default: MDXContent, toc, metadata } = result;
  return (
    <Wrapper toc={toc} metadata={metadata}>
      <MDXContent {...{ params: resolvedParams }} />
    </Wrapper>
  );
}

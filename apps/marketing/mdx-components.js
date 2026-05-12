import { useMDXComponents as getDocsMDXComponents } from "nextra-theme-docs";

const docsComponents = getDocsMDXComponents();

/**
 * Image caption component
 * Use this component to prevent MDX from wrapping text in <p> tags
 */
function ImageCaption({ children }) {
  return (
    <div
      style={{
        fontSize: "12px",
        color: "#666",
        textAlign: "center",
        marginTop: "8px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Label component
 * Use this component to prevent MDX from wrapping text in <p> tags
 */
function Badge({ children, style }) {
  return <span style={style}>{children}</span>;
}

/**
 * MDX component config
 * Merges nextra-theme-docs default components with custom components
 */
export const useMDXComponents = (components) => ({
  ...docsComponents,
  ImageCaption,
  Badge,
  ...components,
});

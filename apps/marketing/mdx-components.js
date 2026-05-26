import defaultMdxComponents from "fumadocs-ui/mdx";

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
 * Merges Fumadocs UI defaults with OpenLoomi-specific components.
 */
export const getMDXComponents = (components = {}) => ({
  ...defaultMdxComponents,
  ImageCaption,
  Badge,
  ...components,
});

export const useMDXComponents = getMDXComponents;

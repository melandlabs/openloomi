"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";

import { Button } from "@openloomi/ui";
import { toast } from "@/components/toast";
import { importRssOpmlClient } from "@/lib/integrations/rss-client";

type RssOpmlImportProps = {
  onImported?: () => Promise<unknown> | unknown;
};

export function RssOpmlImport({ onImported }: RssOpmlImportProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const resetFile = useCallback(() => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        setSelectedFile(null);
        return;
      }

      if (!file.name.toLowerCase().endsWith(".opml")) {
        toast({
          type: "error",
          description: t(
            "integrations.importOpmlInvalidType",
            "Only .opml files are supported.",
          ),
        });
        event.target.value = "";
        setSelectedFile(null);
        return;
      }

      setSelectedFile(file);
    },
    [t],
  );

  /**
   * Handler to trigger OPML import
   * Responsible for validating whether a file has been selected, calling the import API, and triggering callback and resetting state on success
   */
  const handleImport = useCallback(async () => {
    if (!selectedFile) {
      toast({
        type: "error",
        description: t(
          "integrations.importOpmlMissingFile",
          "Select an OPML file before importing.",
        ),
      });
      return;
    }

    setIsImporting(true);
    try {
      const result = await importRssOpmlClient(selectedFile);
      if (result.imported > 0) {
        toast({
          type: "success",
          description: t(
            "integrations.importOpmlSuccess",
            "{{imported}} feeds imported. {{skipped}} skipped.",
            {
              imported: result.imported,
              skipped: result.skipped.length,
            },
          ),
        });
      } else {
        toast({
          type: "error",
          description: t(
            "integrations.importOpmlNoFeeds",
            "We couldn't import any feeds from this file.",
          ),
        });
      }

      await onImported?.();
      resetFile();
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : t(
                "integrations.importOpmlGenericError",
                "We couldn't import that OPML file.",
              ),
      });
    } finally {
      setIsImporting(false);
    }
  }, [onImported, resetFile, selectedFile, t]);

  return (
    <div className="rounded-xl border border-[#e5e5e5] bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-col md:items-start md:justify-between">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#37352f]">
            {t(
              "integrations.importOpmlTitle",
              "Upload an OPML file to import feeds",
            )}
          </h3>
          <p className="text-xs text-[#6f6e69]">
            {t(
              "integrations.importOpmlDescription",
              "Drop in an OPML export from Feedly, Inoreader, or any RSS reader to subscribe to everything at once.",
            )}
          </p>
        </div>
        <div className="flex w-full flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".opml"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex h-16 flex-col items-center justify-center rounded-xl border border-dashed border-[#d8d7d2] px-3 py-2 text-center text-xs text-[#6f6e69]">
            {selectedFile
              ? selectedFile.name
              : t(
                  "integrations.importOpmlFilePlaceholder",
                  "No file selected yet.",
                )}
          </div>
          <div className="flex flex-nowrap items-center gap-2 self-start">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="w-auto shrink-0 justify-center"
            >
              <RemixIcon name="upload_cloud" size="size-4" className="mr-2" />
              {selectedFile
                ? t("integrations.importOpmlChangeCta", "Change file")
                : t("integrations.importOpmlSelectCta", "Choose .opml file")}
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={!selectedFile || isImporting}
              className="w-auto shrink-0 justify-center"
            >
              {isImporting ? (
                <>
                  <RemixIcon
                    name="loader_2"
                    size="size-4"
                    className="mr-2 animate-spin"
                  />
                  {t("integrations.importOpmlUploading", "Importing feeds...")}
                </>
              ) : (
                <>
                  <i className="ri-import-line mr-2 text-base leading-none" />
                  {t("integrations.importOpmlStartCta", "Import feeds")}
                </>
              )}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-[#8f8e88]">
          {t(
            "integrations.importOpmlHint",
            "Only .opml files up to 2MB are accepted. openloomi processes the first 200 feeds per upload.",
          )}
        </p>
      </div>
    </div>
  );
}

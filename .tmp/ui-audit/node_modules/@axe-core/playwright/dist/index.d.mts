import { SerialFrameSelector, RunOptions, AxeResults } from 'axe-core';
import { Page } from 'playwright-core';

interface AxePlaywrightParams {
    page: Page;
    axeSource?: string;
}

declare class AxeBuilder {
    private page;
    private includes;
    private excludes;
    private option;
    private axeSource;
    private legacyMode;
    private errorUrl;
    constructor({ page, axeSource }: AxePlaywrightParams);
    /**
     * Selector to include in analysis.
     * This may be called any number of times.
     * @param String selector
     * @returns this
     */
    include(selector: SerialFrameSelector): this;
    /**
     * Selector to exclude in analysis.
     * This may be called any number of times.
     * @param String selector
     * @returns this
     */
    exclude(selector: SerialFrameSelector): this;
    /**
     * Set options to be passed into axe-core
     * @param RunOptions options
     * @returns AxeBuilder
     */
    options(options: RunOptions): this;
    /**
     * Limit analysis to only the specified rules.
     * Cannot be used with `AxeBuilder#withTags`
     * @param String|Array rules
     * @returns this
     */
    withRules(rules: string | string[]): this;
    /**
     * Limit analysis to only specified tags.
     * Cannot be used with `AxeBuilder#withRules`
     * @param String|Array tags
     * @returns this
     */
    withTags(tags: string | string[]): this;
    /**
     * Set the list of rules to skip when running an analysis.
     * @param String|Array rules
     * @returns this
     */
    disableRules(rules: string | string[]): this;
    /**
     * Use frameMessenger with <same_origin_only>
     *
     * This disables use of axe.runPartial() which is called in each frame, and
     * axe.finishRun() which is called in a blank page. This uses axe.run() instead,
     * but with the restriction that cross-origin frames will not be tested.
     */
    setLegacyMode(legacyMode?: boolean): this;
    /**
     * Perform analysis and retrieve results. *Does not chain.*
     * @return Promise<Result | Error>
     */
    analyze(): Promise<AxeResults>;
    /**
     * Injects `axe-core` into all frames.
     * @param Page - playwright page object
     * @returns Promise<void>
     */
    private inject;
    /**
     * Get axe-core source and configurations
     * @returns String
     */
    private script;
    private runLegacy;
    /**
     * Inject `axe-core` into each frame and run `axe.runPartial`.
     * Because we need to inject axe into all frames all at once
     * (to avoid any potential problems with the DOM becoming out-of-sync)
     * but also need to not process results for any child frames if the parent
     * frame throws an error (requirements of the data structure for `axe.finishRun`),
     *  we have to return a deeply nested array of Promises and then flatten
     * the array once all Promises have finished, throwing out any nested Promises
     * if the parent Promise is not fulfilled.
     * @param frame - playwright frame object
     * @param context - axe-core context object
     * @returns Promise<AxePartialRunner>
     */
    private runPartialRecursive;
    private finishRun;
    private axeConfigure;
}

export { AxeBuilder, AxeBuilder as default };

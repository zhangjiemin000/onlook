import { useUserManager } from '@/components/Context';
import { useTheme } from '@/components/ThemeProvider';
import { invokeMainChannel } from '@/lib/utils';
import type { LocalGatewayTestResult } from '@onlook/models/chat';
import { Language, LANGUAGE_DISPLAY_NAMES, MainChannels, Theme } from '@onlook/models/constants';
import { DEFAULT_IDE } from '@onlook/models/ide';
import { Button } from '@onlook/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@onlook/ui/dropdown-menu';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IDE } from '/common/ide';

const PreferencesTab = observer(() => {
    const userManager = useUserManager();
    const { theme, setTheme } = useTheme();
    const { i18n } = useTranslation();

    const ide = IDE.fromType(userManager.settings.settings?.editor?.ideType || DEFAULT_IDE);
    const isAnalyticsEnabled = userManager.settings.settings?.enableAnalytics || false;
    const shouldWarnDelete = userManager.settings.settings?.editor?.shouldWarnDelete ?? true;
    const savedProxyUrl = userManager.settings.settings?.chat?.customProxyUrl ?? '';
    const savedModel = userManager.settings.settings?.chat?.customModel ?? '';
    const savedApiKey = userManager.settings.settings?.chat?.customApiKey ?? '';
    const [proxyUrl, setProxyUrl] = useState(savedProxyUrl);
    const [modelId, setModelId] = useState(savedModel);
    const [apiKey, setApiKey] = useState(savedApiKey);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<LocalGatewayTestResult | null>(null);
    const IDEIcon = Icons[ide.icon];

    useEffect(() => {
        setProxyUrl(savedProxyUrl);
        setModelId(savedModel);
        setApiKey(savedApiKey);
    }, [savedProxyUrl, savedModel, savedApiKey]);

    function updateIde(ide: IDE) {
        userManager.settings.updateEditor({ ideType: ide.type });
    }

    function updateAnalytics(enabled: boolean) {
        userManager.settings.update({ enableAnalytics: enabled });
        invokeMainChannel(MainChannels.UPDATE_ANALYTICS_PREFERENCE, enabled);
    }

    function updateDeleteWarning(enabled: boolean) {
        userManager.settings.updateEditor({ shouldWarnDelete: enabled });
    }

    async function saveGatewayConfig(nextProxy: string, nextModel: string, nextApiKey: string) {
        setTestResult(null);
        await userManager.settings.updateChat({
            customProxyUrl: nextProxy.trim(),
            customModel: nextModel.trim(),
            customApiKey: nextApiKey.trim(),
        });
    }

    async function testConnection() {
        setIsTesting(true);
        setTestResult(null);
        try {
            await saveGatewayConfig(proxyUrl, modelId, apiKey);
            const result: LocalGatewayTestResult = await invokeMainChannel(
                MainChannels.TEST_LOCAL_AI_CONNECTION,
            );
            setTestResult(result);
        } catch (error) {
            setTestResult({
                success: false,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setIsTesting(false);
        }
    }

    return (
        <div className="flex flex-col gap-8 p-6">
            <div className="flex justify-between items-center gap-4">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Built-in AI Proxy URL (optional)</p>
                    <p className="text-foreground-onlook text-small">
                        Only used by built-in AI. Project preview and external agent tools do not
                        require it.
                    </p>
                </div>
                <Input
                    className="w-[240px] text-small"
                    placeholder="http://127.0.0.1:15721"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    onBlur={() => saveGatewayConfig(proxyUrl, modelId, apiKey)}
                />
            </div>
            <div className="flex justify-between items-center gap-4">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Built-in AI Model ID (optional)</p>
                    <p className="text-foreground-onlook text-small">
                        Leave empty to use environment settings. No model is required for preview or
                        external agents.
                    </p>
                </div>
                <Input
                    className="w-[240px] text-small"
                    placeholder="e.g. deepseek-flash"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    onBlur={() => saveGatewayConfig(proxyUrl, modelId, apiKey)}
                />
            </div>
            <div className="flex justify-between items-center gap-4">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Built-in AI API Token (optional)</p>
                    <p className="text-foreground-onlook text-small">
                        Stored with Electron encryption. Leave empty to use environment credentials.
                    </p>
                </div>
                <Input
                    className="w-[240px] text-small"
                    type="password"
                    autoComplete="off"
                    placeholder="Gateway API token"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={() => saveGatewayConfig(proxyUrl, modelId, apiKey)}
                />
            </div>
            <div className="flex items-center gap-3">
                <Button variant="outline" onClick={testConnection} disabled={isTesting}>
                    {isTesting ? 'Testing connection…' : 'Test built-in AI connection'}
                </Button>
                {testResult && (
                    <p
                        aria-live="polite"
                        className={`text-small ${testResult.success ? 'text-teal-600' : 'text-red-500'}`}
                    >
                        {testResult.model ? `${testResult.model}: ` : ''}
                        {testResult.message}
                    </p>
                )}
            </div>
            <div className="flex justify-between items-center">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Language</p>
                    <p className="text-foreground-onlook text-small">
                        Choose your preferred language
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="text-smallPlus min-w-[150px]">
                            {LANGUAGE_DISPLAY_NAMES[
                                i18n.language as keyof typeof LANGUAGE_DISPLAY_NAMES
                            ] || 'English'}
                            <Icons.ChevronDown className="ml-auto" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-[150px]">
                        {Object.entries(LANGUAGE_DISPLAY_NAMES).map(([code, name]) => (
                            <DropdownMenuItem
                                key={code}
                                onClick={() => userManager.language.update(code as Language)}
                            >
                                <span>{name}</span>
                                {i18n.language === code && (
                                    <Icons.CheckCircled className="ml-auto" />
                                )}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="flex justify-between items-center">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Theme</p>
                    <p className="text-foreground-onlook text-small">
                        Choose your preferred appearance
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="text-smallPlus min-w-[150px]">
                            {theme === Theme.Dark && <Icons.Moon className="mr-2 h-4 w-4" />}
                            {theme === Theme.Light && <Icons.Sun className="mr-2 h-4 w-4" />}
                            {theme === Theme.System && <Icons.Laptop className="mr-2 h-4 w-4" />}
                            <span className="capitalize">{theme}</span>
                            <Icons.ChevronDown className="ml-auto" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-[150px]">
                        <DropdownMenuItem onClick={() => setTheme(Theme.Light)}>
                            <Icons.Sun className="mr-2 h-4 w-4" />
                            <span>Light</span>
                            {theme === Theme.Light && <Icons.CheckCircled className="ml-auto" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme(Theme.Dark)}>
                            <Icons.Moon className="mr-2 h-4 w-4" />
                            <span>Dark</span>
                            {theme === Theme.Dark && <Icons.CheckCircled className="ml-auto" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTheme(Theme.System)}>
                            <Icons.Laptop className="mr-2 h-4 w-4" />
                            <span>System</span>
                            {theme === Theme.System && <Icons.CheckCircled className="ml-auto" />}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="flex justify-between items-center">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Code Editor</p>
                    <p className="text-foreground-onlook text-small">
                        Choose the IDE where you open your code in
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="min-w-[150px]">
                            <IDEIcon className="text-default h-3 w-3 mr-2" />
                            <span className="smallPlus">{ide.displayName}</span>
                            <Icons.ChevronDown className="ml-auto" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        {IDE.getAll().map((item) => {
                            const ItemIcon = Icons[item.icon];
                            return (
                                <DropdownMenuItem
                                    key={item.displayName}
                                    className="text-smallPlus min-w-[140px]"
                                    onSelect={() => {
                                        updateIde(item);
                                    }}
                                >
                                    <ItemIcon className="text-default h-3 w-3 mr-2" />
                                    <span>{item.displayName}</span>
                                    {ide === item && <Icons.CheckCircled className="ml-auto" />}
                                </DropdownMenuItem>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className=" flex justify-between items-center gap-4">
                <div className=" flex flex-col gap-2">
                    <p className="text-largePlus">{'Warn before delete'}</p>
                    <p className="text-foreground-onlook text-small">
                        {'This adds a warning before deleting elements in the editor'}
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="text-smallPlus min-w-[150px]">
                            {shouldWarnDelete ? 'On' : 'Off'}
                            <Icons.ChevronDown className="ml-auto" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="text-smallPlus min-w-[150px]">
                        <DropdownMenuItem onClick={() => updateDeleteWarning(true)}>
                            {'Warning On'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateDeleteWarning(false)}>
                            {'Warning Off'}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="flex justify-between items-center gap-4">
                <div className="flex flex-col gap-2">
                    <p className="text-largePlus">Analytics</p>
                    <p className="text-foreground-onlook text-small">
                        This helps our small team of two know what we need to improve with the
                        product.
                    </p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="text-smallPlus min-w-[150px]">
                            {isAnalyticsEnabled ? 'On' : 'Off'}
                            <Icons.ChevronDown className="ml-auto" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="text-smallPlus min-w-[150px]">
                        <DropdownMenuItem onClick={() => updateAnalytics(true)}>
                            {'Analytics On'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateAnalytics(false)}>
                            {'Analytics Off'}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
});

export default PreferencesTab;

"use client";

import { DragEvent, useState, useRef, useEffect, useCallback } from 'react';
import { Rive, Layout, EventType, Fit, Alignment, StateMachineInputType, StateMachineInput } from '@rive-app/react-webgl2';
import { decodeImage, type Image, type AssetLoadCallback } from '@rive-app/webgl2';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Toaster, toast } from "sonner";

import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { sendGAEvent } from '@next/third-parties/google'
import {
    buildBindingTree,
    watchViewModelInstance,
    applyBindingChange,
    setBindingValueOnNode,
    isPrimitiveType,
} from '@/lib/rive-data-binding';
import type { ViewModelBindingNode, PrimitiveBindingValue } from '@/lib/rive-data-binding';

const normalizeColorHex = (value: PrimitiveBindingValue) => {
    if (typeof value === 'number') {
        const rgb = value & 0xffffff;
        return `#${rgb.toString(16).padStart(6, '0')}`;
    }
    if (typeof value === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(value)) {
        return value.length === 4
            ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
            : value.toLowerCase();
    }
    return '#000000';
};

const formatColorHex = normalizeColorHex;

const parseHexColor = (hex: string): number | null => {
    let normalized = hex.replace('#', '').toLowerCase();
    if (normalized.length === 3) {
        normalized = normalized
            .split('')
            .map((char) => char + char)
            .join('');
    }
    if (normalized.length === 6) {
        return parseInt(`ff${normalized}`, 16);
    }
    if (normalized.length === 8) {
        return parseInt(normalized, 16);
    }
    return null;
};

const fitValues: (keyof typeof Fit)[] = [
    'Cover',
    'Contain',
    'Fill',
    'FitWidth',
    'FitHeight',
    'None',
    'ScaleDown',
];

const fitValueLabels: Record<string, string> = {
    'Cover': '填满（可裁剪） ',
    'Contain': '完整',
    'Fill': '拉伸',
    'FitWidth': '适应宽度',
    'FitHeight': '适应高度',
    'None': '无',
    'ScaleDown': '按需缩小',
};

const alignValues: (keyof typeof Alignment)[] = [
    'TopLeft',
    'TopCenter',
    'TopRight',
    'CenterLeft',
    'Center',
    'CenterRight',
    'BottomLeft',
    'BottomCenter',
    'BottomRight',
];

const ARTBOARD_CLEAR_VALUE = '__artboard_clear__';
const IMAGE_CLEAR_VALUE = '__image_clear__';
const IMAGE_UPLOAD_VALUE = '__image_upload__';
const IMAGE_CUSTOM_PREFIX = '__image_custom__';

enum PlayerState {
    Idle,
    Loading,
    Active,
    Error,
}

enum PlayerError {
    NoAnimation,
}

type BackgroundColor = 'transparent' | 'white' | 'black'

type AlignFitIndex = {
    alignment: number;
    fit: number;
};

type Dimensions = {
    width: number;
    height: number;
};

type Status = {
    current: PlayerState;
    hovering?: boolean;
    error?: PlayerError | null;
};

type RiveAnimations = {
    animations: string[];
    active: string;
};

type RiveStateMachines = {
    stateMachines: string[];
    active: string;
};

type RiveController = {
    active: "animations" | "state-machines";
};

export default function Home() {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const viewModelWatcherRef = useRef<null | (() => void)>(null);
    const dataBindingsRef = useRef<ViewModelBindingNode[]>([]);
    const imageResourcesRef = useRef<Record<string, { image: Image | null; label: string | null; assetKey: string | null; selectValue: string }>>({});
    const imageAssetCacheRef = useRef<Record<string, { bytes: Uint8Array; label: string; image?: Image | null }>>({});
    const imageUploadInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

    const [status, setStatus] = useState<Status>({ current: PlayerState.Idle, hovering: false });
    const [filename, setFilename] = useState<string | null>(null);
    const [fileVersion, setFileVersion] = useState<number>(0);
    const [fileSize, setFileSize] = useState<string | null>(null);
    const [riveAnimation, setRiveAnimation] = useState<Rive | null>(null);
    const [animationList, setAnimationList] = useState<RiveAnimations | null>(null);
    const [stateMachineList, setStateMachineList] = useState<RiveStateMachines | null>(null);
    const [stateMachineInputs, setStateMachineInputs] = useState<StateMachineInput[]>([]);

    const [isPlaying, setIsPlaying] = useState<boolean>(true);
    const [controller, setController] = useState<RiveController>({ active: "state-machines" });
    const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 });

    const [background, setBackground] = useState<BackgroundColor>('black');
    const [alignFitIndex, setAlignFitIndex] = useState<AlignFitIndex>({
        alignment: alignValues.indexOf('Center'),
        fit: fitValues.indexOf('Contain'),
    });
    const [dataBindings, setDataBindings] = useState<ViewModelBindingNode[]>([]);
    const [viewModelOptions, setViewModelOptions] = useState<string[]>([]);
    const [selectedViewModel, setSelectedViewModel] = useState<string | null>(null);
    const [manualViewModelInput, setManualViewModelInput] = useState<string>('');
    const [artboardOptions, setArtboardOptions] = useState<string[]>([]);
    const [imageAssetOptions, setImageAssetOptions] = useState<Array<{ id: string; label: string }>>([]);

    const cleanupImageResources = useCallback(() => {
        Object.values(imageResourcesRef.current).forEach((entry) => {
            entry?.image?.unref?.();
        });
        imageResourcesRef.current = {};
    }, []);

    const cleanupImageAssets = useCallback(() => {
        Object.values(imageAssetCacheRef.current).forEach((entry) => {
            entry?.image?.unref?.();
        });
        imageAssetCacheRef.current = {};
        setImageAssetOptions([]);
    }, []);

    const applyImageLabelsToTree = useCallback((nodes: ViewModelBindingNode[]): ViewModelBindingNode[] => {
        const patchNodes = (list: ViewModelBindingNode[]): ViewModelBindingNode[] => {
            return list.map((node) => {
                let updatedNode = node;
                if (node.type === 'image') {
                    const storedLabel = imageResourcesRef.current[node.path]?.label ?? null;
                    if (storedLabel !== (typeof node.value === 'string' ? node.value : null)) {
                        updatedNode = { ...node, value: storedLabel };
                    }
                }
                if (node.children && node.children.length > 0) {
                    const patchedChildren = patchNodes(node.children);
                    if (patchedChildren !== node.children) {
                        updatedNode = updatedNode === node
                            ? { ...node, children: patchedChildren }
                            : { ...updatedNode, children: patchedChildren };
                    }
                }
                return updatedNode;
            });
        };

        return patchNodes(nodes);
    }, []);

    const updateImageAssetOptions = useCallback(() => {
        const options = Object.entries(imageAssetCacheRef.current).map(([id, entry]) => ({
            id,
            label: entry.label,
        }));
        setImageAssetOptions(options);
    }, []);

    const refreshDataBindings = useCallback(() => {
        viewModelWatcherRef.current?.();
        viewModelWatcherRef.current = null;

        if (!riveAnimation) {
            console.warn('[DataBinding] refresh skipped: riveAnimation missing');
            setDataBindings([]);
            return;
        }

        const instance = riveAnimation.viewModelInstance;
        if (!instance) {
            console.warn('[DataBinding] refresh skipped: viewModelInstance missing');
            setDataBindings([]);
            return;
        }

        const tree = applyImageLabelsToTree(buildBindingTree(instance));
        if (tree.length === 0) {
            console.warn('[DataBinding] bound view model has no exposed properties', {
                properties: instance.properties?.map((property) => ({ name: property.name, type: property.type })),
                selectedViewModel,
            });
        }
        console.log('[DataBinding] binding tree rebuilt', { nodes: tree.length });
        setDataBindings(tree);
        viewModelWatcherRef.current = watchViewModelInstance(instance, (change) => {
            setDataBindings((current) => applyBindingChange(current, change));
        });
    }, [applyImageLabelsToTree, riveAnimation, selectedViewModel]);

    useEffect(() => {
        dataBindingsRef.current = dataBindings;
    }, [dataBindings]);

    useEffect(() => {
        return () => {
            viewModelWatcherRef.current?.();
            viewModelWatcherRef.current = null;
        };
    }, []);

    useEffect(() => {
        return () => {
            cleanupImageResources();
        };
    }, [cleanupImageResources]);
    useEffect(() => {
        return () => {
            cleanupImageAssets();
        };
    }, [cleanupImageAssets]);
    useEffect(() => {
        if (riveAnimation) {
            riveAnimation.layout = new Layout({
                fit: getFitValue(alignFitIndex),
                alignment: getAlignmentValue(alignFitIndex),
            });
        }
    }, [alignFitIndex, riveAnimation]);

    useEffect(() => {
        if (canvasRef.current && dimensions && riveAnimation) {
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
            riveAnimation.resizeToCanvas();
        }

        if (typeof window !== 'undefined') {
            //  TODO: handle hiding some elements on mobile
            // window.innerWidth < 800 ? console.log('Mobile') : console.log('Desktop');
        }
    }, [dimensions, riveAnimation]);

    const updateDimensions = useCallback(() => {
        const targetDimensions = previewRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
        setDimensions((current) => {
            if (targetDimensions.width === current.width && targetDimensions.height === current.height) {
                return current;
            }
            return {
                width: targetDimensions.width,
                height: targetDimensions.height,
            };
        });
    }, []);

    useEffect(() => {
        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, [updateDimensions]);

    const togglePlayback = () => {
        const active = animationList?.active;
        if (active) {
            !isPlaying && riveAnimation?.play(active);
            isPlaying && riveAnimation?.pause(active);
        }
    };

    const handleRiveAssetLoad = useCallback<AssetLoadCallback>((asset, bytes) => {
        try {
            if (asset.isImage) {
                const key = asset.uniqueFilename || asset.name || `image_${Object.keys(imageAssetCacheRef.current).length + 1}`;
                const copy = bytes.slice ? bytes.slice() : new Uint8Array(bytes);
                imageAssetCacheRef.current[key] = {
                    bytes: copy,
                    label: asset.name || asset.uniqueFilename || key,
                    image: null,
                };
            }
            asset.decode(bytes);
            return true;
        } catch (err) {
            console.error('[DataBinding] asset loader failed', err);
            return false;
        }
    }, []);

    const setAnimationWithBuffer = async (buffer: string | ArrayBuffer | null) => {
        if (!buffer) return;

        setStatus({ current: PlayerState.Loading });
        cleanupImageResources();
        cleanupImageAssets();
        viewModelWatcherRef.current?.();
        viewModelWatcherRef.current = null;
        setDataBindings([]);
        dataBindingsRef.current = [];
        setViewModelOptions([]);
        setSelectedViewModel(null);

        try {
            riveAnimation?.cleanup();
            const newRiveAnimation = new Rive({
                buffer: buffer as ArrayBuffer,
                canvas: canvasRef.current!,
                autoplay: false,
                autoBind: true,
                stateMachines: "state-machines",
                layout: new Layout({
                    fit: getFitValue(alignFitIndex),
                    alignment: getAlignmentValue(alignFitIndex),
                }),
                assetLoader: handleRiveAssetLoad,
                onLoad: () => {
                    // 先设置状态为 Active
                    setStatus({ current: PlayerState.Active });

                    // 等待下一个事件循环再设置状态机
                    setTimeout(() => {
                        const stateMachines = newRiveAnimation.stateMachineNames;
                        if (stateMachines && stateMachines.length > 0) {
                            const firstStateMachine = stateMachines[0];
                            // 获取状态机的输入
                            const inputs = newRiveAnimation.stateMachineInputs(firstStateMachine);
                            if (inputs) {
                                setStateMachineInputs(inputs);
                                console.log('[StateMachine] active inputs', inputs);
                                console.log('Initial state machine inputs:', inputs);
                                // 播放状态机
                                newRiveAnimation.play(firstStateMachine);
                            }
                        }
                    }, 0);
                }
            });
            setRiveAnimation(newRiveAnimation);
        } catch (e) {
            console.error('Rive loading error:', e);
            setStatus({ current: PlayerState.Error, error: PlayerError.NoAnimation });
        }
    };

    const load = async (file: File) => {
        setFilename(file.name);
        setFileVersion((prev) => prev + 1);
        setFileSize(formatFileSize(file.size));

        const reader = new FileReader();
        reader.onload = async () => {
            await setAnimationWithBuffer(reader.result);
        };
        reader.readAsArrayBuffer(file);

        sendGAEvent('event', 'upload', { filename: file.name, fileSize: file.size });
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' bytes';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    };

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        riveAnimation?.stop();
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, [riveAnimation]);

    const reset = useCallback(() => {
        setIsPlaying(true);
        setFilename(null);
        setRiveAnimation(null);
        setAnimationList(null);
        setStateMachineList(null);
        setStatus((prev) => ({ ...prev, current: PlayerState.Idle }));
        viewModelWatcherRef.current?.();
        viewModelWatcherRef.current = null;
        setDataBindings([]);
        dataBindingsRef.current = [];
        setArtboardOptions([]);
        cleanupImageResources();
        cleanupImageAssets();
        clearCanvas();
    }, [cleanupImageAssets, cleanupImageResources, clearCanvas]);

    const setActiveAnimation = useCallback((animation: string) => {
        if (!riveAnimation) return;
        clearCanvas();
        setAnimationList((prev) => {
            if (!prev) return prev;
            riveAnimation.stop(prev.active);
            riveAnimation.play(animation);
            return {
                ...prev,
                active: animation,
            };
        });
    }, [clearCanvas, riveAnimation]);

    const bindViewModelByName = useCallback((viewModelName: string | null) => {
        if (!riveAnimation || !viewModelName) {
            console.warn('[DataBinding] bind aborted - missing riveAnimation or name');
            return false;
        }
        const viewModel = riveAnimation.viewModelByName(viewModelName);
        if (!viewModel) {
            console.warn('[DataBinding] viewModel not found', viewModelName);
            return false;
        }
        const instance = viewModel.defaultInstance();
        if (!instance) {
            console.warn('[DataBinding] default instance missing for viewModel', viewModelName);
            return false;
        }
        riveAnimation.bindViewModelInstance(instance);
        setSelectedViewModel(viewModelName);
        refreshDataBindings();
        console.log('[DataBinding] bound viewModel', viewModelName);
        return true;
    }, [refreshDataBindings, riveAnimation]);

    const bindDefaultViewModel = useCallback(() => {
        if (!riveAnimation) {
            console.warn('[DataBinding] bind default aborted - missing riveAnimation');
            return false;
        }
        const defaultViewModel = riveAnimation.defaultViewModel();
        if (!defaultViewModel) {
            console.warn('[DataBinding] no default ViewModel defined in file');
            return false;
        }
        const instance = defaultViewModel.defaultInstance();
        if (!instance) {
            console.warn('[DataBinding] default ViewModel lacks default instance');
            return false;
        }
        riveAnimation.bindViewModelInstance(instance);
        setSelectedViewModel(defaultViewModel.name ?? 'Default');
        refreshDataBindings();
        console.log('[DataBinding] bound default ViewModel', defaultViewModel.name);
        return true;
    }, [refreshDataBindings, riveAnimation]);

    const setActiveStateMachine = useCallback((stateMachine: string) => {
        if (!riveAnimation) return;
        
        setStateMachineList((prev) => (prev ? {
            ...prev,
            active: stateMachine,
        } : prev));

        riveAnimation.stop();
        riveAnimation.play(stateMachine);
        const inputs = riveAnimation.stateMachineInputs(stateMachine);
        if (inputs) {
            setStateMachineInputs(inputs);
            console.log('New state machine inputs:', inputs); // 添加日志
        }
        if (selectedViewModel) {
            bindViewModelByName(selectedViewModel);
        } else {
            bindDefaultViewModel();
        }
    }, [bindDefaultViewModel, bindViewModelByName, riveAnimation, selectedViewModel]);

    const setControllerState = useCallback((state: string) => {
        if (state !== "animations" && state !== "state-machines") return;

        setController((prev) => ({
            ...prev,
            active: state === "animations" ? "animations" : "state-machines",
        }));

        if (state === "animations" && animationList) {
            setActiveAnimation(animationList.active);
        } else if (state === "state-machines" && stateMachineList) {
            setActiveStateMachine(stateMachineList.active);
        }
    }, [animationList, setActiveAnimation, setActiveStateMachine, stateMachineList]);

    const getAnimationList = useCallback(() => {
        const animations = riveAnimation?.animationNames;
        if (!animations) return;

        setAnimationList({ animations, active: animations[0] });
    }, [riveAnimation]);

    const getStateMachineList = useCallback(() => {
        const stateMachines = riveAnimation?.stateMachineNames;
        if (!stateMachines || stateMachines.length === 0) return;

        const firstStateMachine = stateMachines[0];
        setStateMachineList({
            stateMachines,
            active: firstStateMachine
        });

        if (riveAnimation) {
            riveAnimation.stop();
            riveAnimation.play(firstStateMachine);
            const inputs = riveAnimation.stateMachineInputs(firstStateMachine);
            setStateMachineInputs(inputs);
        }
    }, [riveAnimation]);

    const updateViewModelOptions = useCallback(() => {
        if (!riveAnimation) {
            setViewModelOptions([]);
            setSelectedViewModel(null);
            return;
        }

        const names: string[] = [];
        const contents = riveAnimation.contents;

        const defaultViewModel = riveAnimation.defaultViewModel();
        if (defaultViewModel) {
            names.push(defaultViewModel.name ?? 'Default');
        }

        setViewModelOptions(names);
        console.log('[DataBinding] detected view models', names, contents);

        if (names.length === 0) {
            viewModelWatcherRef.current?.();
            viewModelWatcherRef.current = null;
            setSelectedViewModel(null);
            setDataBindings([]);
            try {
                riveAnimation.bindViewModelInstance(null);
            } catch (err) {
                console.warn('[DataBinding] failed to clear ViewModel binding', err);
            }
            return;
        }

        const resolveSelection = (current: string | null) => {
            if (current && names.includes(current)) {
                return current;
            }
            return names[0] ?? null;
        };

        const nextSelection = resolveSelection(selectedViewModel);
        setSelectedViewModel(nextSelection);

        if (nextSelection) {
            bindViewModelByName(nextSelection);
            return;
        }

        bindDefaultViewModel();
    }, [bindDefaultViewModel, bindViewModelByName, riveAnimation, selectedViewModel]);

    const updateArtboardOptions = useCallback(() => {
        if (!riveAnimation) {
            setArtboardOptions([]);
            return;
        }

        const contents = riveAnimation.contents;
        const names =
            contents?.artboards
                ?.map((artboard) => artboard?.name)
                .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? [];

        setArtboardOptions(names);
    }, [riveAnimation]);

    const setArtboardBindingValue = useCallback((node: ViewModelBindingNode, artboardName: string | null) => {
        if (!riveAnimation) {
            console.warn('[DataBinding] artboard update skipped - missing riveAnimation');
            return false;
        }

        if (!node.targetInstance || !node.propertyName) {
            console.warn('[DataBinding] artboard node missing target', node);
            return false;
        }

        const accessor = node.targetInstance.artboard(node.propertyName);
        if (!accessor) {
            console.warn('[DataBinding] artboard accessor missing', node.path);
            return false;
        }

        if (artboardName) {
            const bindableArtboard = riveAnimation.getBindableArtboard(artboardName);
            if (!bindableArtboard) {
                console.warn('[DataBinding] target artboard not found', artboardName);
                return false;
            }
            accessor.value = bindableArtboard;
        } else {
            accessor.value = null;
        }

        setDataBindings((current) =>
            applyBindingChange(current, {
                path: node.path,
                type: node.type,
                value: artboardName ?? null,
            }),
        );

        console.log('[DataBinding] artboard updated', { path: node.path, value: artboardName ?? 'none' });
        return true;
    }, [riveAnimation]);

    const setImageResourceEntry = useCallback((path: string, image: Image | null, label: string | null, assetKey: string | null, selectValue: string) => {
        const existing = imageResourcesRef.current[path];
        if (existing?.image && existing.image !== image) {
            existing.image.unref?.();
        }

        if (!image && !label && !assetKey) {
            delete imageResourcesRef.current[path];
            return;
        }

        imageResourcesRef.current[path] = { image, label, assetKey, selectValue };
    }, []);

    const handleImageSelection = useCallback(async (node: ViewModelBindingNode, assetKey: string | null) => {
        if (!riveAnimation) {
            console.warn('[DataBinding] image selection skipped - missing riveAnimation');
            return;
        }

        if (!node.targetInstance || !node.propertyName) {
            console.warn('[DataBinding] image node missing target', node);
            return;
        }

        const accessor = node.targetInstance.image(node.propertyName);
        if (!accessor) {
            console.warn('[DataBinding] image accessor missing', node.path);
            return;
        }

        if (!assetKey) {
            accessor.value = null;
            setImageResourceEntry(node.path, null, null, null, IMAGE_CLEAR_VALUE);
            setDataBindings((current) =>
                applyBindingChange(current, {
                    path: node.path,
                    type: node.type,
                    value: null,
                }),
            );
            console.log('[DataBinding] image cleared', { path: node.path });
            return;
        }

        const assetEntry = imageAssetCacheRef.current[assetKey];
        if (!assetEntry) {
            console.warn('[DataBinding] asset not found for image binding', assetKey);
            return;
        }

        if (!assetEntry.image) {
            assetEntry.image = await decodeImage(assetEntry.bytes);
        }

        accessor.value = assetEntry.image;
        setImageResourceEntry(node.path, assetEntry.image, assetEntry.label, assetKey, assetKey);
        setDataBindings((current) =>
            applyBindingChange(current, {
                path: node.path,
                type: node.type,
                value: assetEntry.label,
            }),
        );
        console.log('[DataBinding] image updated', { path: node.path, assetKey });
    }, [riveAnimation, setImageResourceEntry]);

    const handleImageFileChange = useCallback(async (node: ViewModelBindingNode, file: File | null) => {
        if (!riveAnimation) {
            console.warn('[DataBinding] image update skipped - missing riveAnimation');
            return;
        }

        if (!node.targetInstance || !node.propertyName) {
            console.warn('[DataBinding] image node missing target', node);
            return;
        }

        const accessor = node.targetInstance.image(node.propertyName);
        if (!accessor) {
            console.warn('[DataBinding] image accessor missing', node.path);
            return;
        }

        if (!file) {
            accessor.value = null;
            setImageResourceEntry(node.path, null, null, null, IMAGE_CLEAR_VALUE);
            setDataBindings((current) =>
                applyBindingChange(current, {
                    path: node.path,
                    type: node.type,
                    value: null,
                }),
            );
            console.log('[DataBinding] image cleared', { path: node.path });
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const decoded = await decodeImage(bytes);

            accessor.value = decoded;
            setImageResourceEntry(node.path, decoded, file.name, null, `${IMAGE_CUSTOM_PREFIX}${node.path}`);
            setDataBindings((current) =>
                applyBindingChange(current, {
                    path: node.path,
                    type: node.type,
                    value: file.name,
                }),
            );
            console.log('[DataBinding] image updated', { path: node.path, file: file.name });
        } catch (err) {
            console.error('[DataBinding] failed to decode image', err);
        }
    }, [riveAnimation, setImageResourceEntry]);

    const triggerImageUpload = useCallback((path: string) => {
        const input = imageUploadInputsRef.current[path];
        if (input) {
            input.click();
        } else {
            console.warn('[DataBinding] image upload input missing', path);
        }
    }, []);

    const handleImageSelectChange = useCallback((node: ViewModelBindingNode, value: string) => {
        if (value === IMAGE_UPLOAD_VALUE) {
            triggerImageUpload(node.path);
            return;
        }
        if (value === IMAGE_CLEAR_VALUE) {
            handleImageSelection(node, null);
            return;
        }
        if (value.startsWith(IMAGE_CUSTOM_PREFIX)) {
            return;
        }
        handleImageSelection(node, value);
    }, [handleImageSelection, triggerImageUpload]);

    const handleBindingValueChange = useCallback((node: ViewModelBindingNode, rawValue: PrimitiveBindingValue | string) => {
        if (!riveAnimation) return;
        const instance = riveAnimation.viewModelInstance;
        if (!instance) return;

        if (!node.targetInstance || !node.propertyName) {
            console.warn('[DataBinding] node missing target', node);
            return;
        }

        if (node.type === 'artboard') {
            const nextName = typeof rawValue === 'string' && rawValue !== ARTBOARD_CLEAR_VALUE ? rawValue : null;
            const success = setArtboardBindingValue(node, nextName);
            if (!success) {
                console.warn('[DataBinding] failed to update artboard', { path: node.path, rawValue });
            }
            return;
        }

        if (node.type === 'image') {
            console.warn('[DataBinding] image updates must use file input handler');
            return;
        }

        if (node.type === 'trigger') {
            const success = setBindingValueOnNode(node, null);
            if (success) {
                setDataBindings((current) => applyBindingChange(current, {
                    path: node.path,
                    type: node.type,
                    value: Date.now(),
                }));
                console.log('[DataBinding] trigger fired', { path: node.path });
            } else {
                console.warn('[DataBinding] trigger failed', { path: node.path });
            }
            return;
        }

        let nextValue: PrimitiveBindingValue = rawValue as PrimitiveBindingValue;

        if (node.type === 'color' && typeof rawValue === 'string') {
            const parsed = parseHexColor(rawValue);
            if (parsed === null) {
                console.warn('[DataBinding] invalid color hex', rawValue);
                return;
            }
            nextValue = parsed;
        } else if (node.type === 'number' && typeof rawValue === 'string') {
            const parsedNumber = Number(rawValue);
            if (Number.isNaN(parsedNumber)) {
                console.warn('[DataBinding] invalid number input', rawValue);
                return;
            }
            nextValue = parsedNumber;
        }

        const success = setBindingValueOnNode(node, nextValue);
        if (success) {
            setDataBindings((current) => applyBindingChange(current, {
                path: node.path,
                type: node.type,
                value: nextValue,
            }));
            console.log('[DataBinding] value updated', { path: node.path, type: node.type, value: nextValue });
        } else {
            console.warn('[DataBinding] failed to update value', { path: node.path, type: node.type, rawValue });
        }
    }, [riveAnimation, setArtboardBindingValue]);

    const renderBindingInput = (node: ViewModelBindingNode) => {
        switch (node.type) {
            case 'string':
                return (
                    <Input
                        className="w-40"
                        value={typeof node.value === 'string' ? node.value : ''}
                        onChange={(e) => handleBindingValueChange(node, e.target.value)}
                    />
                );
            case 'number':
                return (
                    <Input
                        className="w-32"
                        type="number"
                        value={typeof node.value === 'number' ? String(node.value) : ''}
                        onChange={(e) => handleBindingValueChange(node, e.target.value)}
                    />
                );
            case 'boolean':
                return (
                    <Switch
                        checked={Boolean(node.value)}
                        onCheckedChange={(checked) => handleBindingValueChange(node, checked)}
                    />
                );
            case 'color':
                return (
                    <Input
                        type="color"
                        className="w-16 h-8 p-1"
                        value={formatColorHex(node.value ?? null)}
                        onChange={(e) => handleBindingValueChange(node, e.target.value)}
                    />
                );
            case 'enumType':
                return (
                    <Select
                        value={typeof node.value === 'string' ? node.value : undefined}
                        onValueChange={(val) => handleBindingValueChange(node, val)}
                    >
                        <SelectTrigger className="w-40">
                            <SelectValue placeholder="选择值" />
                        </SelectTrigger>
                        <SelectContent>
                            {node.enumValues?.map((option) => (
                                <SelectItem key={option} value={option}>
                                    {option}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                );
            case 'trigger':
                return (
                    <Button size="xs" variant="outline" onClick={() => handleBindingValueChange(node, null)}>
                        触发
                    </Button>
                );
            case 'artboard':
                return (
                    <Select
                        value={typeof node.value === 'string' ? node.value : ARTBOARD_CLEAR_VALUE}
                        onValueChange={(val) => handleBindingValueChange(node, val)}
                    >
                        <SelectTrigger className="w-48">
                            <SelectValue placeholder={artboardOptions.length > 0 ? "选择 Artboard" : "未检测到 Artboard"} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ARTBOARD_CLEAR_VALUE}>未绑定</SelectItem>
                            {artboardOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                    {option}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                );
            case 'image':
                return (
                    <div className="flex items-center gap-2">
                        <Select
                            value={imageResourcesRef.current[node.path]?.selectValue ?? IMAGE_CLEAR_VALUE}
                            onValueChange={(val) => handleImageSelectChange(node, val)}
                        >
                            <SelectTrigger className="w-56">
                                <SelectValue placeholder={imageAssetOptions.length > 0 ? "选择图片" : "未检测到图片"} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={IMAGE_CLEAR_VALUE}>未绑定</SelectItem>
                                {imageAssetOptions.map((option) => (
                                    <SelectItem key={option.id} value={option.id}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                                {imageResourcesRef.current[node.path]?.label && !imageResourcesRef.current[node.path]?.assetKey && (
                                    <SelectItem value={imageResourcesRef.current[node.path]!.selectValue}>
                                        自定义: {imageResourcesRef.current[node.path]!.label}
                                    </SelectItem>
                                )}
                                <SelectItem value={IMAGE_UPLOAD_VALUE}>上传图片…</SelectItem>
                            </SelectContent>
                        </Select>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/avif"
                            className="hidden"
                            ref={(el) => {
                                imageUploadInputsRef.current[node.path] = el;
                            }}
                            onChange={(e) => {
                                const file = e.target.files?.[0] ?? null;
                                handleImageFileChange(node, file);
                                e.target.value = '';
                            }}
                        />
                    </div>
                );
            default:
                return null;
        }
    };

    const renderBindingTree = (nodes: ViewModelBindingNode[], depth = 0) => {
        return nodes.map((node) => {
            const hasChildren = node.children && node.children.length > 0;
            const isEditable = isPrimitiveType(node.type);
            return (
                <div key={node.path} className="flex flex-col gap-2">
                    <div className="flex w-full items-center gap-2" style={{ paddingLeft: `${depth * 12}px` }}>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate break-all" title={node.path}>{node.name}</p>
                        </div>
                        {isEditable ? (
                            renderBindingInput(node)
                        ) : (
                            <span className="text-xs text-muted-foreground">分组</span>
                        )}
                    </div>
                    {hasChildren && (
                        <div className="flex flex-col gap-2">
                            {renderBindingTree(node.children!, depth + 1)}
                        </div>
                    )}
                </div>
            );
        });
    };

    const handleRiveLoad = useCallback(() => {
        getStateMachineList();
        getAnimationList();
        setStatus({ current: PlayerState.Active, error: null });
        setControllerState("state-machines");
        refreshDataBindings();
        updateViewModelOptions();
        updateArtboardOptions();
        updateImageAssetOptions();

        if (riveAnimation) {
            const stateMachines = riveAnimation.stateMachineNames;
            if (stateMachines && stateMachines.length > 0) {
                const firstStateMachine = stateMachines[0];
                riveAnimation.stop();
                riveAnimation.play(firstStateMachine);
                const inputs = riveAnimation.stateMachineInputs(firstStateMachine);
                if (inputs) {
                    setStateMachineInputs(inputs);
                    console.log('State machine inputs:', inputs);
                }
            }
        }
    }, [getAnimationList, getStateMachineList, refreshDataBindings, riveAnimation, setControllerState, updateArtboardOptions, updateImageAssetOptions, updateViewModelOptions]);

    useEffect(() => {
        if (!riveAnimation) return;

        const handleLoadError = () => {
            setStatus({ current: PlayerState.Error, error: PlayerError.NoAnimation });
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleStop = () => setIsPlaying(false);

        riveAnimation.on(EventType.Load, handleRiveLoad);
        riveAnimation.on(EventType.LoadError, handleLoadError);
        riveAnimation.on(EventType.Play, handlePlay);
        riveAnimation.on(EventType.Pause, handlePause);
        riveAnimation.on(EventType.Stop, handleStop);

        return () => {
            riveAnimation.off(EventType.Load, handleRiveLoad);
            riveAnimation.off(EventType.LoadError, handleLoadError);
            riveAnimation.off(EventType.Play, handlePlay);
            riveAnimation.off(EventType.Pause, handlePause);
            riveAnimation.off(EventType.Stop, handleStop);
        };
    }, [riveAnimation, handleRiveLoad]);

    useEffect(() => {
        if (status.current === PlayerState.Error && status.error !== null) {
            reset();
            fireErrorToast();
        } else {
            if (status.current === PlayerState.Active && !animationList) { getAnimationList(); }
            if (status.current === PlayerState.Active && !stateMachineList) { getStateMachineList(); }
        }
    }, [status, animationList, getAnimationList, getStateMachineList, reset, stateMachineList]);

    const lastActivatedStateMachine = useRef<string | null>(null);
    const lastActivatedAnimation = useRef<string | null>(null);

    useEffect(() => {
        lastActivatedStateMachine.current = null;
        lastActivatedAnimation.current = null;
    }, [fileVersion]);

    useEffect(() => {
        if (controller.active === "state-machines" && stateMachineList) {
            const target = stateMachineList.active;
            if (lastActivatedStateMachine.current !== target) {
                lastActivatedStateMachine.current = target;
                setActiveStateMachine(target);
            }
        } else if (controller.active === "animations" && animationList) {
            const target = animationList.active;
            if (lastActivatedAnimation.current !== target) {
                lastActivatedAnimation.current = target;
                setActiveAnimation(target);
            }
        }
    }, [animationList, controller.active, setActiveAnimation, setActiveStateMachine, stateMachineList]);

    const getFitValue = (alignFitIndex: AlignFitIndex) => {
        return Fit[fitValues[alignFitIndex.fit]];
    };

    const getAlignmentValue = (alignFitIndex: AlignFitIndex) => {
        return Alignment[alignValues[alignFitIndex.alignment]];
    };

    const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
        setStatus({ ...status, hovering: true });
        e.preventDefault();
        e.stopPropagation();
    }

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        setStatus({ ...status, hovering: false });
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        setStatus({ ...status, hovering: true });
        e.dataTransfer.dropEffect = 'copy';
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        setStatus({ ...status, hovering: false });
        load(e.dataTransfer.files[0]);
        e.preventDefault();
        e.stopPropagation();
    };

    const shouldDisplayCanvas = () => [PlayerState.Active, PlayerState.Loading].includes(status.current);

    const fireErrorToast = () => {
        toast.error("Your file has no animations.");
    }

    const component_prompt = () => {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ display: shouldDisplayCanvas() ? 'none' : 'flex' }}>
                <Upload className="w-8 h-8" />
                拖拽一个 Rive 文件或
                <Button onClick={() => inputRef.current?.click()} >
                    浏览
                </Button>
                <input hidden type="file" accept=".riv" ref={inputRef}
                    onChange={(e) => {
                        const files = e.target.files;
                        if (files) {
                            const droppedFile = files[0];
                            load(droppedFile);
                        }
                    }}
                />
            </div>
        );
    };

    const component_canvas = () => {
        return <canvas ref={canvasRef} style={{ display: shouldDisplayCanvas() ? 'block' : 'none' }} className={`${background === 'white' ? 'bg-white' : background === 'black' ? 'bg-black' : ''}`} />;
    }

    const component_controlsCard = () => {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>控制面板</CardTitle>
                    <CardDescription>数据源和触发器</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <Tabs
                        value={controller.active}
                        className="w-full flex flex-col items-center"
                        onValueChange={(value) => setControllerState(value)}
                    >
                        <TabsList className="grid w-full grid-cols-2 mb-2">
                            <TabsTrigger value="animations">动画</TabsTrigger>
                            <TabsTrigger value="state-machines">状态机</TabsTrigger>
                        </TabsList>
                        <TabsContent value="animations" className="w-full">
                            <div className="w-full">
                                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                                    {animationList?.animations.map((animation, index) => (
                                        <li key={index} className="w-full">
                                            <Button
                                                variant={animationList.active === animation ? "default" : "outline"}
                                                onClick={() => setActiveAnimation(animation)}
                                                className="w-full"
                                                size="xs"
                                            >
                                                {animation}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </TabsContent>
                        <TabsContent value="state-machines" className="w-full">
                            <Select
                                value={stateMachineList?.active}
                                onValueChange={(value) => setActiveStateMachine(value)}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择状态机" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectLabel>可用状态机</SelectLabel>
                                        {stateMachineList?.stateMachines.map((stateMachine) => (
                                            <SelectItem key={stateMachine} value={stateMachine}>{stateMachine}</SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <div className="w-full mt-2">
                                {/* first show the number inputs */}
                                {stateMachineInputs?.some((input) => input.type === StateMachineInputType.Number) && (
                                    <>
                                        <h2 className="text-lg font-medium mb-2">Input</h2>
                                        <ul className="flex flex-col gap-2 w-full">
                                            {stateMachineInputs?.filter((input) => input.type === StateMachineInputType.Number).map((input, index) => (
                                                <li key={index} className="w-full">
                                                    <div className="w-full max-w-sm">
                                                        <Label htmlFor={input.name}>
                                                            {input.name}
                                                        </Label>
                                                        <Input
                                                            type="number"
                                                            id={input.name}
                                                            placeholder=""
                                                            // value={input.value as number}
                                                            onChange={(e) => {
                                                                const newValue = parseFloat(e.target.value);
                                                                console.log('Number input: ', input.name, ' New value: ', newValue);
                                                                input.value = newValue;
                                                                console.log(input);
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}

                                {/* then show the trigger inputs */}
                                {stateMachineInputs?.some((input) => input.type === StateMachineInputType.Trigger) && (
                                    <>
                                        <h2 className="text-lg font-medium mt-4 mb-2">触发器</h2>
                                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                                            {stateMachineInputs?.filter((input) => input.type === StateMachineInputType.Trigger).map((input, index) => (
                                                <li key={index} className="w-full">
                                                    <Button
                                                        variant="default"
                                                        onClick={() => {
                                                            console.log('input: ', input);
                                                            input.fire();
                                                        }}
                                                        className="w-full"
                                                        size="xs"
                                                    >
                                                        {input.name}
                                                    </Button>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}

                                {/* then show the boolean inputs */}
                                {stateMachineInputs?.some((input) => input.type === StateMachineInputType.Boolean) && (
                                    <>
                                        <h2 className="text-lg font-medium mt-4 mb-2">布尔值</h2>
                                        <ul className="flex flex-col gap-2 w-full">
                                            {stateMachineInputs?.filter((input) => input.type === StateMachineInputType.Boolean).map((input, index) => (
                                                <li key={index} className="w-full">
                                                    <div className="flex items-center space-x-2">
                                                        <Switch
                                                            id={input.name}
                                                            // checked={input.value as boolean}
                                                            onCheckedChange={(value) => {
                                                                console.log('Boolean input: ', input.name, ' New value: ', value);
                                                                input.value = value;
                                                            }}
                                                        />
                                                        <Label htmlFor={input.name}>{input.name}</Label>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </div>
                            {dataBindings.length > 0 && (
                                <div className="w-full mt-4 flex flex-col gap-2">
                                    <Separator className="my-2" />
                                    <div className="flex flex-col w-full gap-1">
                                        <h4 className="text-lg font-medium mb-2">Data Binding</h4>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <Label className="text-xs text-muted-foreground">ViewModel</Label>
                                        {viewModelOptions.length > 0 ? (
                                            <Select
                                                value={selectedViewModel ?? viewModelOptions[0]}
                                                onValueChange={(value) => bindViewModelByName(value)}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="选择 ViewModel" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {viewModelOptions.map((option) => (
                                                        <SelectItem key={option} value={option}>
                                                            {option}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="flex gap-2 w-full">
                                                <Input
                                                    placeholder="输入 ViewModel 名称"
                                                    value={manualViewModelInput}
                                                    onChange={(e) => setManualViewModelInput(e.target.value)}
                                                />
                                                <Button
                                                    type="button"
                                                    onClick={() => bindViewModelByName(manualViewModelInput.trim())}
                                                    disabled={!manualViewModelInput.trim()}
                                                >
                                                    绑定
                                                </Button>
                                            </div>
                                        )}
                                        {viewModelOptions.length === 0 && (
                                            <p className="text-xs text-muted-foreground">
                                                文件未提供默认 ViewModel，请在 Rive 中设置 Default Instance 后再试。
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-col w-full gap-3 -mr-6">
                                        {renderBindingTree(dataBindings)}
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                    {/* only show the play/pause button if the controller is on animations */}
                    {controller.active === "animations" && (
                        <>
                            <Separator orientation="horizontal" />
                            <Button
                                onClick={() => { togglePlayback(); }}
                                disabled={status.current !== PlayerState.Active}
                                variant="secondary"
                            >
                                {status.current !== PlayerState.Active ? "播放/暂停" : isPlaying ? '暂停' : '播放'}
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>
        );
    }

    const component_appearanceCard = () => {
        return (
            <Card className="w-full overflow-x-hidden">
                <CardHeader>
                    <CardTitle>
                        外观
                    </CardTitle>
                    <CardDescription>
                        自定义显示效果
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="w-full">
                        <h2 className="text-lg font-medium mb-2">背景颜色</h2>
                        <Select
                            value={background}
                            onValueChange={(value) => setBackground(value as BackgroundColor)}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="选择背景" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectLabel>可用背景</SelectLabel>
                                    <SelectItem value="white">白色</SelectItem>
                                    <SelectItem value="black">黑色</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const component_layoutCard = () => {
        return (
            <Card className="w-full overflow-x-hidden">
                <CardHeader>
                    <CardTitle>
                        布局
                    </CardTitle>
                    <CardDescription>
                        调整动画布局
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="w-full">
                        <div className="flex flex-row flex-wrap justify-between items-center gap-2 mb-2">
                            <h2 className="text-lg font-medium pr-8">适配方式</h2>
                            <div className="w-auto min-w-40">
                                <Select
                                    value={fitValues[alignFitIndex.fit]}
                                    onValueChange={(value) => setAlignFitIndex({ ...alignFitIndex, fit: fitValues.indexOf(value as keyof typeof Fit) })}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select Fit" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectLabel>可用适配方式</SelectLabel>
                                            {fitValues.map((fit) => (
                                                <SelectItem key={fit} value={fit}>
                                                    {fitValueLabels[fit] || fit}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex flex-row justify-between flex-wrap">
                            <h2 className="text-lg font-medium mt-4 pr-8">对齐方式</h2>
                            <div className="grid grid-rows-[36px_36px_36px] grid-cols-[36px_36px_36px] gap-2 mt-4 mb-2">
                                {alignValues.map((_, index) => (
                                    <button
                                        key={`btn_${index}`}
                                        onClick={() => setAlignFitIndex({ ...alignFitIndex, alignment: index })}
                                        className={`w-[36px] h-[36px] ${alignFitIndex.alignment === index ? 'bg-foreground' : 'bg-muted'} hover:bg-secondary-foreground rounded-lg transition-colors`}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const component_header = () => {
        return (
            <div className="relative flex w-full flex-col items-start">
                <section className="mx-auto flex flex-col items-start gap-2 px-4 py-8 md:py-12 md:pb-8 lg:py-12 lg::pb-10 w-full">
                    <h1 className="text-3xl font-bold leading-tight tracking-tighter md:text-4xl lg:leading-[1.1] hidden md:block">
                        Rive 效果预览
                    </h1>
                    <h1 className="text-3xl font-bold leading-tight tracking-tighter md:text-4xl lg:leading-[1.1] md:hidden">
                        Rive 运行时
                    </h1>
                    <p className="max-w-2xl text-lg font-light text-foreground">测试动画和状态机的交互效果</p>
                </section>
            </div>
        );
    }

    return (
        <>
            <main className="flex-1">
                <Toaster richColors visibleToasts={10} />
                <div id='container' className="px-8 max-w-[1400px] mx-auto">
                    {component_header()}
                    <div className="grid grid-cols-[1fr_300px] gap-4">
                        <div className="flex flex-col gap-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>预览</CardTitle>
                                    <CardDescription>
                                        {filename ? (
                                            <span>
                                                {filename}
                                                <span className="inline-block min-w-2">&nbsp;</span>
                                                <span className="text-muted-foreground">({fileSize})</span>
                                            </span>
                                        ) : (
                                            '选择文件开始预览'
                                        )}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div
                                        ref={previewRef}
                                        className="relative w-full h-[600px] rounded-lg overflow-hidden"
                                        onDrop={(e) => handleDrop(e)}
                                        onDragOver={(e) => handleDragOver(e)}
                                        onDragEnter={(e) => handleDragEnter(e)}
                                        onDragLeave={(e) => handleDragLeave(e)}
                                    >
                                        {component_canvas()}
                                        {component_prompt()}
                                    </div>
                                </CardContent>
                            </Card>
                            <div className="grid grid-cols-2 gap-4">
                                {component_appearanceCard()}
                                {component_layoutCard()}
                            </div>
                        </div>
                        {component_controlsCard()}
                    </div>
                </div>
            </main>
        </>
    );
}

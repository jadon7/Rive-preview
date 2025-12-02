import type {
    ViewModelInstance,
    ViewModelInstanceList,
} from '@rive-app/webgl2';
type ViewModelProperty = { name: string; type: RiveDataType | string };
type RiveDataType = number;

const DATA_TYPES = {
    none: 0,
    string: 1,
    number: 2,
    boolean: 3,
    color: 4,
    list: 5,
    enumType: 6,
    trigger: 7,
    viewModel: 8,
} as const;

type DataTypeKey = keyof typeof DATA_TYPES;

export type PrimitiveBindingValue = string | number | boolean | null;

export interface ViewModelBindingNode {
    path: string;
    name: string;
    type: DataTypeKey;
    value?: PrimitiveBindingValue;
    enumValues?: string[];
    children?: ViewModelBindingNode[];
    targetInstance?: ViewModelInstance;
    propertyName?: string;
}

export interface BindingChange {
    path: string;
    type: DataTypeKey;
    value: PrimitiveBindingValue;
}

const primitiveTypes = new Set<DataTypeKey>(['boolean', 'color', 'enumType', 'number', 'string', 'trigger']);

const childTypes = new Set<DataTypeKey>(['list', 'viewModel']);

export const DATA_TYPE_KEYS = DATA_TYPES;
export const isPrimitiveType = (type: DataTypeKey) => primitiveTypes.has(type);

const resolveTypeKey = (type: RiveDataType | string): DataTypeKey | undefined => {
    if (typeof type === 'string') {
        if (type in DATA_TYPES) {
            return type as DataTypeKey;
        }
        return undefined;
    }
    return Object.entries(DATA_TYPES).find(([, value]) => value === type)?.[0] as DataTypeKey | undefined;
};

const getPropertyPath = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);

export const buildBindingTree = (instance: ViewModelInstance | null): ViewModelBindingNode[] => {
    if (!instance) return [];
    return traverseBindingTree(instance, '');
};

const traverseBindingTree = (instance: ViewModelInstance, prefix: string): ViewModelBindingNode[] => {
    const properties: ViewModelProperty[] = instance.properties ?? [];

    const nodes = properties.flatMap((property): ViewModelBindingNode[] => {
        const path = getPropertyPath(prefix, property.name);
        const typeKey = resolveTypeKey(property.type);
        if (!typeKey) {
            console.warn('[DataBinding] unsupported property type', property);
            return [];
        }
        switch (typeKey) {
            case 'string': {
                const ref = instance.string(property.name);
                return [{ path, name: property.name, type: typeKey, value: ref?.value ?? null, targetInstance: instance, propertyName: property.name }];
            }
            case 'number': {
                const ref = instance.number(property.name);
                return [{ path, name: property.name, type: typeKey, value: ref?.value ?? null, targetInstance: instance, propertyName: property.name }];
            }
            case 'boolean': {
                const ref = instance.boolean(property.name);
                return [{ path, name: property.name, type: typeKey, value: ref?.value ?? null, targetInstance: instance, propertyName: property.name }];
            }
            case 'color': {
                const ref = instance.color(property.name);
                return [{ path, name: property.name, type: typeKey, value: ref?.value ?? null, targetInstance: instance, propertyName: property.name }];
            }
            case 'enumType': {
                const ref = instance.enum(property.name);
                return [{ path, name: property.name, type: typeKey, value: ref?.value ?? null, enumValues: ref?.values ?? [], targetInstance: instance, propertyName: property.name }];
            }
            case 'trigger': {
                return [{ path, name: property.name, type: typeKey, value: null, targetInstance: instance, propertyName: property.name }];
            }
            case 'viewModel': {
                const child = instance.viewModel(property.name);
                return [{ path, name: property.name, type: typeKey, children: child ? traverseBindingTree(child, path) : [] }];
            }
            case 'list': {
                const list = instance.list(property.name);
                if (!list) {
                    return [{ path, name: property.name, type: typeKey, children: [] }];
                }
                return [{ path, name: property.name, type: typeKey, children: buildListChildren(list, path) }];
            }
            default:
                return [];
        }
    });

    return nodes;
};

const buildListChildren = (
    list: ViewModelInstanceList,
    prefix: string,
): ViewModelBindingNode[] => {
    const items: ViewModelBindingNode[] = [];
    const entryCount = list.length ?? 0;

    for (let index = 0; index < entryCount; index += 1) {
        const instance = list.instanceAt(index);
        if (!instance) continue;
        const path = `${prefix}[${index}]`;
        items.push({
            path,
            name: `${prefix.split('/').pop() ?? 'item'}[${index}]`,
            type: 'viewModel',
            children: traverseBindingTree(instance, path),
        });
    }

    return items;
};

export const watchViewModelInstance = (
    instance: ViewModelInstance | null,
    onChange: (update: BindingChange) => void,
): (() => void) => {
    if (!instance) return () => undefined;

    const unsubs: Array<() => void> = [];
    const visit = (scope: ViewModelInstance, prefix: string) => {
        const properties: ViewModelProperty[] = scope.properties ?? [];
        properties.forEach((property) => {
            const path = getPropertyPath(prefix, property.name);
            const typeKey = resolveTypeKey(property.type);
            if (!typeKey) {
                console.warn('[DataBinding] skip watch: unsupported type', property);
                return;
            }
            if (primitiveTypes.has(typeKey)) {
                const ref = getPropertyAccessor(scope, property.name, typeKey);
                if (!ref) return;
                const handler = () => {
                    onChange({
                        path,
                        type: typeKey,
                        value: readPrimitiveValue(typeKey, ref),
                    });
                };
                ref.on(handler);
                unsubs.push(() => ref.off(handler));
                return;
            }

            if (childTypes.has(typeKey)) {
                if (typeKey === 'viewModel') {
                    const child = scope.viewModel(property.name);
                    if (child) visit(child, path);
                } else if (typeKey === 'list') {
                    const list = scope.list(property.name);
                    if (list) {
                        const entryCount = list.length ?? 0;
                        for (let index = 0; index < entryCount; index += 1) {
                            const child = list.instanceAt(index);
                            if (child) {
                                visit(child, `${path}[${index}]`);
                            }
                        }
                    }
                }
            }
        });
    };

    visit(instance, '');

    return () => {
        unsubs.forEach((unsubscribe) => unsubscribe());
    };
};

const getPropertyAccessor = (
    instance: ViewModelInstance,
    propertyName: string,
    type: DataTypeKey,
) => {
    switch (type) {
        case 'string':
            return instance.string(propertyName);
        case 'number':
            return instance.number(propertyName);
        case 'boolean':
            return instance.boolean(propertyName);
        case 'color':
            return instance.color(propertyName);
        case 'enumType':
            return instance.enum(propertyName);
        case 'trigger':
            return instance.trigger(propertyName);
        default:
            return null;
    }
};

const readPrimitiveValue = (
    type: DataTypeKey,
    accessor:
        | ReturnType<ViewModelInstance['string']>
        | ReturnType<ViewModelInstance['number']>
        | ReturnType<ViewModelInstance['boolean']>
        | ReturnType<ViewModelInstance['color']>
        | ReturnType<ViewModelInstance['enum']>
        | ReturnType<ViewModelInstance['trigger']>
        | null,
): PrimitiveBindingValue => {
    if (!accessor) return null;
    switch (type) {
        case 'string':
        case 'enumType':
            return (accessor as ReturnType<ViewModelInstance['string']>)?.value ?? null;
        case 'number':
        case 'color':
            return (accessor as ReturnType<ViewModelInstance['number']>)?.value ?? null;
        case 'boolean':
            return (accessor as ReturnType<ViewModelInstance['boolean']>)?.value ?? null;
        case 'trigger':
            return Date.now();
        default:
            return null;
    }
};

export const applyBindingChange = (
    nodes: ViewModelBindingNode[],
    change: BindingChange,
): ViewModelBindingNode[] => {
    const next = updateNodes(nodes, change);
    return next ?? nodes;
};

const updateNodes = (
    nodes: ViewModelBindingNode[],
    change: BindingChange,
): ViewModelBindingNode[] | null => {
    let mutated = false;
    const nextNodes = nodes.map((node) => {
        const updated = updateNode(node, change);
        if (updated !== node) mutated = true;
        return updated;
    });

    return mutated ? nextNodes : null;
};

const updateNode = (
    node: ViewModelBindingNode,
    change: BindingChange,
): ViewModelBindingNode => {
    if (node.path === change.path) {
        if (node.value === change.value) return node;
        return {
            ...node,
            value: change.value,
        };
    }

    if (node.children && node.children.length > 0) {
        const updatedChildren = updateNodes(node.children, change);
        if (updatedChildren) {
            return {
                ...node,
                children: updatedChildren,
            };
        }
    }

    return node;
};

const normalizeNumericValue = (value: PrimitiveBindingValue) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
};

export const setBindingValueOnNode = (
    node: ViewModelBindingNode,
    value: PrimitiveBindingValue,
): boolean => {
    const { targetInstance, propertyName, type } = node;
    if (!targetInstance || !propertyName) {
        console.warn('[DataBinding] missing target instance for node', node.path);
        return false;
    }
    const accessor = getPropertyAccessor(targetInstance, propertyName, type);
    if (!accessor) {
        console.warn('[DataBinding] unable to resolve accessor', node.path, type);
        return false;
    }
    const bindingAccessor = accessor;

    switch (type) {
        case 'string':
            (bindingAccessor as NonNullable<ReturnType<ViewModelInstance['string']>>).value = typeof value === 'string' ? value : '';
            return true;
        case 'enumType':
            if (typeof value === 'string') {
                (bindingAccessor as NonNullable<ReturnType<ViewModelInstance['string']>>).value = value;
                return true;
            }
            return false;
        case 'number': {
            const numeric = normalizeNumericValue(value);
            if (numeric === null) return false;
            (bindingAccessor as NonNullable<ReturnType<ViewModelInstance['number']>>).value = numeric;
            return true;
        }
        case 'color': {
            const numeric = normalizeNumericValue(value);
            if (numeric === null) return false;
            (bindingAccessor as NonNullable<ReturnType<ViewModelInstance['color']>>).value = numeric;
            return true;
        }
        case 'boolean':
            (bindingAccessor as NonNullable<ReturnType<ViewModelInstance['boolean']>>).value = Boolean(value);
            return true;
        case 'trigger':
            (bindingAccessor as NonNullable<ReturnType<ViewModelInstance['trigger']>>).trigger();
            return true;
        default:
            return false;
    }
};

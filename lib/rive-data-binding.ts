import type {
    ViewModelInstance,
    ViewModelInstanceList,
} from '@rive-app/webgl2';
type ViewModelProperty = { name: string; type: RiveDataType };
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

export type PrimitiveBindingValue = string | number | boolean | null;

export interface ViewModelBindingNode {
    path: string;
    name: string;
    type: RiveDataType;
    value?: PrimitiveBindingValue;
    enumValues?: string[];
    children?: ViewModelBindingNode[];
}

export interface BindingChange {
    path: string;
    type: RiveDataType;
    value: PrimitiveBindingValue;
}

const primitiveTypes = new Set<RiveDataType>([
    DATA_TYPES.boolean,
    DATA_TYPES.color,
    DATA_TYPES.enumType,
    DATA_TYPES.number,
    DATA_TYPES.string,
    DATA_TYPES.trigger,
]);

const childTypes = new Set<RiveDataType>([DATA_TYPES.list, DATA_TYPES.viewModel]);

const getPropertyPath = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);

export const buildBindingTree = (instance: ViewModelInstance | null): ViewModelBindingNode[] => {
    if (!instance) return [];
    return traverseBindingTree(instance, '');
};

const traverseBindingTree = (instance: ViewModelInstance, prefix: string): ViewModelBindingNode[] => {
    const properties: ViewModelProperty[] = instance.properties ?? [];

    const nodes = properties.flatMap((property): ViewModelBindingNode[] => {
        const path = getPropertyPath(prefix, property.name);
        switch (property.type) {
            case DATA_TYPES.string: {
                const ref = instance.string(property.name);
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    value: ref?.value ?? null,
                }];
            }
            case DATA_TYPES.number: {
                const ref = instance.number(property.name);
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    value: ref?.value ?? null,
                }];
            }
            case DATA_TYPES.boolean: {
                const ref = instance.boolean(property.name);
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    value: ref?.value ?? null,
                }];
            }
            case DATA_TYPES.color: {
                const ref = instance.color(property.name);
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    value: ref?.value ?? null,
                }];
            }
            case DATA_TYPES.enumType: {
                const ref = instance.enum(property.name);
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    value: ref?.value ?? null,
                    enumValues: ref?.values ?? [],
                }];
            }
            case DATA_TYPES.trigger: {
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    value: null,
                }];
            }
            case DATA_TYPES.viewModel: {
                const child = instance.viewModel(property.name);
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    children: child ? traverseBindingTree(child, path) : [],
                }];
            }
            case DATA_TYPES.list: {
                const list = instance.list(property.name);
                if (!list) {
                    return [{
                        path,
                        name: property.name,
                        type: property.type,
                        children: [],
                    }];
                }
                return [{
                    path,
                    name: property.name,
                    type: property.type,
                    children: buildListChildren(list, path),
                }];
            }
            default:
                return [];
        }
    });

    return nodes;;
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
            type: DATA_TYPES.viewModel,
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
            if (primitiveTypes.has(property.type)) {
                const ref = getPropertyAccessor(scope, property);
                if (!ref) return;
                const handler = () => {
                    onChange({
                        path,
                        type: property.type,
                        value: readPrimitiveValue(property.type, ref),
                    });
                };
                ref.on(handler);
                unsubs.push(() => ref.off(handler));
                return;
            }

            if (childTypes.has(property.type)) {
                if (property.type === DATA_TYPES.viewModel) {
                    const child = scope.viewModel(property.name);
                    if (child) visit(child, path);
                } else if (property.type === DATA_TYPES.list) {
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
    property: ViewModelProperty,
) => {
    switch (property.type) {
        case DATA_TYPES.string:
            return instance.string(property.name);
        case DATA_TYPES.number:
            return instance.number(property.name);
        case DATA_TYPES.boolean:
            return instance.boolean(property.name);
        case DATA_TYPES.color:
            return instance.color(property.name);
        case DATA_TYPES.enumType:
            return instance.enum(property.name);
        case DATA_TYPES.trigger:
            return instance.trigger(property.name);
        default:
            return null;
    }
};

const readPrimitiveValue = (
    type: RiveDataType,
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
        case DATA_TYPES.string:
        case DATA_TYPES.enumType:
            return (accessor as ReturnType<ViewModelInstance['string']>)?.value ?? null;
        case DATA_TYPES.number:
        case DATA_TYPES.color:
            return (accessor as ReturnType<ViewModelInstance['number']>)?.value ?? null;
        case DATA_TYPES.boolean:
            return (accessor as ReturnType<ViewModelInstance['boolean']>)?.value ?? null;
        case DATA_TYPES.trigger:
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

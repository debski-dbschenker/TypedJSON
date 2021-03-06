import { Constructor } from "./typedjson/types";
import * as Helpers from "./typedjson/helpers";
import { JsonObjectMetadata } from "./typedjson/metadata";
import { Deserializer } from "./typedjson/deserializer";
import { Serializer } from "./typedjson/serializer";

export interface ITypedJSONSettings
{
    /**
     * Sets the handler callback to invoke on errors during serializing and deserializing.
     * Re-throwing errors in this function will halt serialization/deserialization.
     * The default behavior is to log errors to the console.
     */
    errorHandler?: (e: Error) => void;

    /**
     * Sets a callback that determines the constructor of the correct sub-type of polymorphic objects while deserializing.
     * The default behavior is to read the type-name from the '__type' property of 'sourceObject', and look it up in 'knownTypes'.
     * The constructor of the sub-type should be returned.
     */
    typeResolver?: (sourceObject: Object, knownTypes: Map<string, Function>) => Function;

    nameResolver?: (ctor: Function) => string;

    /**
     * Sets a callback that writes type-hints to serialized objects.
     * The default behavior is to write the type-name to the '__type' property, if a derived type is present in place of a base type.
     */
    typeHintEmitter?: (targetObject: Object, sourceObject: Object, expectedSourceType: Function) => void;

    /**
     * Sets the amount of indentation to use in produced JSON strings.
     * Default value is 0, or no indentation.
     */
    indent?: number;

    replacer?: (key: string, value: any) => any;

    knownTypes?: Array<Constructor<any>>;
}

export class TypedJSON<T>
{
    //#region Static
    public static parse<T>(json: string, rootType: Constructor<T>, settings?: ITypedJSONSettings)
    {
        return new TypedJSON(rootType, settings).parse(json);
    }

    public static parseAsArray<T>(json: string, elementType: Constructor<T>, settings?: ITypedJSONSettings): T[]
    {
        return new TypedJSON(elementType, settings).parseAsArray(json);
    }

    public static parseAsSet<T>(json: string, elementType: Constructor<T>, settings?: ITypedJSONSettings): Set<T>
    {
        return new TypedJSON(elementType, settings).parseAsSet(json);
    }

    public static parseAsMap<K, V>(json: string, keyType: Constructor<K>, valueType: Constructor<V>, settings?: ITypedJSONSettings): Map<K, V>
    {
        return new TypedJSON(valueType, settings).parseAsMap(json, keyType);
    }

    public static stringify<T>(object: T, rootType: Constructor<T>, settings?: ITypedJSONSettings)
    {
        return new TypedJSON(rootType, settings).stringify(object);
    }

    public static stringifyAsArray<T>(object: T[], elementType: Constructor<T>, dimensions?: 1, settings?: ITypedJSONSettings): string;
    public static stringifyAsArray<T>(object: T[][], elementType: Constructor<T>, dimensions: 2, settings?: ITypedJSONSettings): string;
    public static stringifyAsArray<T>(object: T[][][], elementType: Constructor<T>, dimensions: 3, settings?: ITypedJSONSettings): string;
    public static stringifyAsArray<T>(object: T[][][][], elementType: Constructor<T>, dimensions: 4, settings?: ITypedJSONSettings): string;
    public static stringifyAsArray<T>(object: T[][][][][], elementType: Constructor<T>, dimensions: 5, settings?: ITypedJSONSettings): string;
    public static stringifyAsArray<T>(object: any[], elementType: Constructor<T>, dimensions: number = 1, settings?: ITypedJSONSettings): string
    {
        return new TypedJSON(elementType, settings).stringifyAsArray(object, dimensions as any);
    }

    public static stringifyAsSet<T>(object: Set<T>, elementType: Constructor<T>, settings?: ITypedJSONSettings): string
    {
        return new TypedJSON(elementType, settings).stringifyAsSet(object);
    }

    public static stringifyAsMap<K, V>(object: Map<K, V>, keyCtor: Constructor<K>, valueCtor: Constructor<V>, settings?: ITypedJSONSettings): string
    {
        return new TypedJSON(valueCtor, settings).stringifyAsMap(object, keyCtor);
    }

    private static _globalConfig: ITypedJSONSettings;

    public static setGlobalConfig(config: ITypedJSONSettings)
    {
        if (this._globalConfig)
        {
            Object.assign(this._globalConfig, config);
        }
        else
        {
            this._globalConfig = config;
        }
    }

    //#endregion

    private serializer: Serializer = new Serializer();
    private deserializer: Deserializer<T> = new Deserializer<T>();
    private globalKnownTypes: Array<Constructor<any>> = [];
    private indent: number = 0;
    private rootConstructor: Constructor<T>;
    private errorHandler: (e: Error) => void;
    private nameResolver: (ctor: Function) => string;
    private replacer: (key: string, value: any) => any;

    /**
     * Creates a new TypedJSON instance to serialize (stringify) and deserialize (parse) object instances of the specified root class type.
     * @param rootType The constructor of the root class type.
     * @param settings Additional configuration settings.
     */
    constructor(rootConstructor: Constructor<T>, settings?: ITypedJSONSettings)
    {
        let rootMetadata = JsonObjectMetadata.getFromConstructor(rootConstructor);

        if (!rootMetadata || !rootMetadata.isExplicitlyMarked)
        {
            throw new TypeError("The TypedJSON root data type must have the @jsonObject decorator used.");
        }

        this.nameResolver = (ctor) => Helpers.nameof(ctor);
        this.rootConstructor = rootConstructor;
        this.errorHandler = (error) => Helpers.logError(error);

        if (settings)
        {
            this.config(settings);
        }
        else if (TypedJSON._globalConfig)
        {
            this.config({});
        }
    }

    /**
     * Configures TypedJSON through a settings object.
     * @param settings The configuration settings object.
     */
    public config(settings: ITypedJSONSettings)
    {
        if (TypedJSON._globalConfig)
        {
            settings = {
                ...TypedJSON._globalConfig,
                ...settings
            };

            if (settings.knownTypes && TypedJSON._globalConfig.knownTypes)
            {
                // Merge known-types (also de-duplicate them, so Array -> Set -> Array).
                settings.knownTypes = Array.from(new Set(settings.knownTypes.concat(TypedJSON._globalConfig.knownTypes)));
            }
        }

        if (settings.errorHandler)
        {
            this.errorHandler = settings.errorHandler;
            this.deserializer.setErrorHandler(settings.errorHandler);
            this.serializer.setErrorHandler(settings.errorHandler);
        }

        if (settings.replacer) this.replacer = settings.replacer;
        if (settings.typeResolver) this.deserializer.setTypeResolver(settings.typeResolver);
        if (settings.typeHintEmitter) this.serializer.setTypeHintEmitter(settings.typeHintEmitter);
        if (settings.indent) this.indent = settings.indent;

        if (settings.nameResolver)
        {
            this.nameResolver = settings.nameResolver;
            this.deserializer.setNameResolver(settings.nameResolver);
            // this.serializer.set
        }

        if (settings.knownTypes)
        {
            // Type-check knownTypes elements to recognize errors in advance.
            settings.knownTypes.forEach((knownType, i) =>
            {
                // tslint:disable-next-line:no-null-keyword
                if (typeof knownType === "undefined" || knownType === null)
                {
                    Helpers.logWarning(`TypedJSON.config: 'knownTypes' contains an undefined/null value (element ${i}).`);
                }
            });

            this.globalKnownTypes = settings.knownTypes;
        }
    }

    /**
     * Converts a JSON string to the root class type.
     * @param json The JSON string to parse and convert.
     * @throws Error if any errors are thrown in the specified errorHandler callback (re-thrown).
     */
    public parse(json: string): T
    {
        let rootMetadata = JsonObjectMetadata.getFromConstructor(this.rootConstructor);
        let result: T;
        let knownTypes = new Map<string, Function>();

        this.globalKnownTypes.filter(ktc => ktc).forEach(knownTypeCtor =>
        {
            knownTypes.set(this.nameResolver(knownTypeCtor), knownTypeCtor);
        });

        if (rootMetadata)
        {
            rootMetadata.knownTypes.forEach(knownTypeCtor =>
            {
                knownTypes.set(this.nameResolver(knownTypeCtor), knownTypeCtor);
            });
        }

        try
        {
            result = this.deserializer.convertSingleValue(JSON.parse(json), {
                selfConstructor: this.rootConstructor,
                knownTypes: knownTypes
            }) as T;
        }
        catch (e)
        {
            this.errorHandler(e);
        }

        return result;
    }

    public parseAsArray(json: string, dimensions: number = 1): T[]
    {
        let object = JSON.parse(json);

        if (object instanceof Array)
        {
            return this.deserializer.convertAsArray(object, {
                selfConstructor: Array,
                elementConstructor: new Array((dimensions - 1) || 0).fill(Array).concat(this.rootConstructor),
                knownTypes: this._mapKnownTypes(this.globalKnownTypes)
            });
        }
        else
        {
            this.errorHandler(new TypeError(`Expected 'json' to define an Array, but got ${typeof object}.`));
        }

        return [];
    }

    public parseAsSet(json: string): Set<T>
    {
        let object = JSON.parse(json);

        // A Set<T> is serialized as T[].
        if (object instanceof Array)
        {
            return this.deserializer.convertAsSet(object, {
                selfConstructor: Array,
                elementConstructor: [this.rootConstructor],
                knownTypes: this._mapKnownTypes(this.globalKnownTypes)
            });
        }
        else
        {
            this.errorHandler(new TypeError(`Expected 'json' to define a Set (using an Array), but got ${typeof object}.`));
        }

        return new Set<T>();
    }

    public parseAsMap<K>(json: string, keyConstructor: Constructor<K>): Map<K, T>
    {
        let object = JSON.parse(json);

        // A Set<T> is serialized as T[].
        if (object instanceof Array)
        {
            return this.deserializer.convertAsMap(object, {
                selfConstructor: Array,
                elementConstructor: [this.rootConstructor],
                knownTypes: this._mapKnownTypes(this.globalKnownTypes),
                keyConstructor: keyConstructor
            });
        }
        else
        {
            this.errorHandler(new TypeError(`Expected 'json' to define a Set (using an Array), but got ${typeof object}.`));
        }

        return new Map<K, T>();
    }

    /**
     * Converts an instance of the specified class type to a JSON string.
     * @param object The instance to convert to a JSON string.
     * @throws Error if any errors are thrown in the specified errorHandler callback (re-thrown).
     */
    public stringify(object: T): string
    {
        let serializedObject: Object;

        if (!(object as any instanceof this.rootConstructor))
        {
            this.errorHandler(TypeError(`Expected object type to be '${Helpers.nameof(this.rootConstructor)}', got '${Helpers.nameof(object.constructor)}'.`));
            return undefined;
        }

        try
        {
            serializedObject = this.serializer.convertSingleValue(object, {
                selfType: this.rootConstructor
            });

            return JSON.stringify(serializedObject, this.replacer, this.indent);
        }
        catch (e)
        {
            this.errorHandler(e);
        }

        return "";
    }

    public stringifyAsArray(object: T[], dimensions?: 1): string;
    public stringifyAsArray(object: T[][], dimensions: 2): string;
    public stringifyAsArray(object: T[][][], dimensions: 3): string;
    public stringifyAsArray(object: T[][][][], dimensions: 4): string;
    public stringifyAsArray(object: T[][][][][], dimensions: 5): string;
    public stringifyAsArray(object: any[], dimensions: number = 1): string
    {
        let elementConstructorArray = new Array((dimensions - 1) || 0).fill(Array).concat(this.rootConstructor);

        return JSON.stringify(this.serializer.convertAsArray(object, elementConstructorArray), this.replacer, this.indent);
    }

    public stringifyAsSet(object: Set<T>): string
    {
        return JSON.stringify(this.serializer.convertAsSet(object, this.rootConstructor), this.replacer, this.indent);
    }

    public stringifyAsMap<K>(object: Map<K, T>, keyConstructor: Constructor<K>): string
    {
        return JSON.stringify(this.serializer.convertAsMap(object, keyConstructor, this.rootConstructor), this.replacer, this.indent);
    }

    private _mapKnownTypes(constructors: Array<Constructor<any>>)
    {
        let map = new Map<string, Constructor<any>>();

        constructors.filter(ctor => ctor).forEach(ctor => map.set(this.nameResolver(ctor), ctor));

        return map;
    }
}

export { jsonObject } from "./typedjson/json-object";
export { jsonMember } from "./typedjson/json-member";
export { jsonArrayMember } from "./typedjson/json-array-member";
export { jsonSetMember } from "./typedjson/json-set-member";
export { jsonMapMember } from "./typedjson/json-map-member";

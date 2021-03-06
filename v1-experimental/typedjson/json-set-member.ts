﻿import { nameof } from "./helpers";
import { IJsonMemberOptions } from "./json-member";
import { JsonMemberMetadata, JsonObjectMetadata, injectMetadataInformation } from "./metadata";
import * as Helpers from "./helpers";

declare abstract class Reflect
{
    public static getMetadata(metadataKey: string, target: any, targetKey: string | symbol): any;
}

export interface IJsonSetMemberOptions
{
    /** When set, indicates that the member must be present when deserializing. */
    isRequired?: boolean;

    /** When set, a default value is emitted for each uninitialized json member. */
    emitDefaultValue?: boolean;
}

/**
 * Specifies that the property is part of the object when serializing.
 * Use this decorator on properties of type Set<T>.
 * @param elementConstructor Constructor of set elements (e.g. 'Number' for Set<number> or 'Date' for Set<Date>).
 * @param options Additional options.
 */
export function jsonSetMember(elementConstructor: Function, options: IJsonSetMemberOptions = {})
{
    return (target: Object, propKey: string | symbol) =>
    {
        var decoratorName = `@jsonSetMember on ${nameof(target.constructor)}.${propKey}`; // For error messages.

        if (typeof elementConstructor !== "function")
        {
            Helpers.logError(`${decoratorName}: could not resolve constructor of set elements at runtime.`);
            return;
        }

        // If ReflectDecorators is available, use it to check whether 'jsonSetMember' has been used on a set. Warn if not.
        if (Helpers.isReflectMetadataSupported && Reflect.getMetadata("design:type", target, propKey) !== Set)
        {
            Helpers.logError(`${decoratorName}: property is not a Set.`);
            return;
        }

        var metadata = new JsonMemberMetadata();

        metadata.ctor = Set;
        metadata.elementType = [elementConstructor];
        metadata.emitDefaultValue = options.emitDefaultValue || false;
        metadata.isRequired = options.isRequired || false;
        metadata.key = propKey.toString();
        metadata.name = propKey.toString();

        injectMetadataInformation(target, propKey, metadata);
    };
}

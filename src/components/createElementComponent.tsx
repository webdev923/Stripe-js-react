// Must use `import *` or named imports for React's types
import {FunctionComponent} from 'react';
import * as stripeJs from '@stripe/stripe-js';

import React from 'react';

import PropTypes from 'prop-types';

import {useCartElementContextWithUseCase} from './Elements';
import {useAttachEvent} from '../utils/useAttachEvent';
import {ElementProps} from '../types';
import {usePrevious} from '../utils/usePrevious';
import {
  extractAllowedOptionsUpdates,
  UnknownOptions,
} from '../utils/extractAllowedOptionsUpdates';
import {useElementsOrCustomCheckoutSdkContextWithUseCase} from './CustomCheckout';

type UnknownCallback = (...args: unknown[]) => any;

interface PrivateElementProps {
  id?: string;
  className?: string;
  onChange?: UnknownCallback;
  onBlur?: UnknownCallback;
  onFocus?: UnknownCallback;
  onEscape?: UnknownCallback;
  onReady?: UnknownCallback;
  onClick?: UnknownCallback;
  onLoadError?: UnknownCallback;
  onLoaderStart?: UnknownCallback;
  onNetworksChange?: UnknownCallback;
  onCheckout?: UnknownCallback;
  onLineItemClick?: UnknownCallback;
  onConfirm?: UnknownCallback;
  onCancel?: UnknownCallback;
  onShippingAddressChange?: UnknownCallback;
  onShippingRateChange?: UnknownCallback;
  options?: UnknownOptions;
}

const capitalized = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

// The Element instances [adds and removes classes][0] from the container node
// it is mounted to. We also want to be able to manage the class of the
// container node via the `className` prop passed to the Element wrapper
// component. If we naively apply the `className` prop, it will overwrite the
// classes that the Element instance has set for itself ([#267][1]).
//
// So instead, we track the current and previous value of the `className` prop.
// After each render, we _append_ every class in the current `className` prop
// to the container `class`, then remove any class that was in the previous
// `className` prop but is not in the current prop.
//
// [0]: https://stripe.com/docs/js/element/the_element_container
// [1]: https://github.com/stripe/react-stripe-js/issues/267
const useClassName = (domNode: HTMLDivElement | null, classNameProp = '') => {
  const previousClassNamePropRef = React.useRef(classNameProp);

  React.useLayoutEffect(() => {
    const previousClassNameProp = previousClassNamePropRef.current;
    previousClassNamePropRef.current = classNameProp;

    if (!domNode) {
      return;
    }

    const previousClassNames = previousClassNameProp
      .split(/\s+/)
      .filter((n) => n.length);
    const classNames = classNameProp.split(/\s+/).filter((n) => n.length);
    const removedClassNames = previousClassNames.filter(
      (n) => !classNames.includes(n)
    );

    domNode.classList.add(...classNames);
    domNode.classList.remove(...removedClassNames);
  }, [domNode, classNameProp]);

  // track previous classnames
  // merge provided classnames and existing classnames on domNode
  // remove the previous classnames not in the current classnames
};

const createElementComponent = (
  type: stripeJs.StripeElementType,
  isServer: boolean
): FunctionComponent<ElementProps> => {
  const displayName = `${capitalized(type)}Element`;

  const ClientElement: FunctionComponent<PrivateElementProps> = ({
    id,
    className,
    options = {},
    onBlur,
    onFocus,
    onReady,
    onChange,
    onEscape,
    onClick,
    onLoadError,
    onLoaderStart,
    onNetworksChange,
    onCheckout,
    onLineItemClick,
    onConfirm,
    onCancel,
    onShippingAddressChange,
    onShippingRateChange,
  }) => {
    const ctx = useElementsOrCustomCheckoutSdkContextWithUseCase(
      `mounts <${displayName}>`
    );
    const elements = 'elements' in ctx ? ctx.elements : null;
    const customCheckoutSdk =
      'customCheckoutSdk' in ctx ? ctx.customCheckoutSdk : null;
    const [element, setElement] = React.useState<stripeJs.StripeElement | null>(
      null
    );
    const elementRef = React.useRef<stripeJs.StripeElement | null>(null);
    const [domNode, setDomNode] = React.useState<HTMLDivElement | null>(null);

    const {setCart, setCartState} = useCartElementContextWithUseCase(
      `mounts <${displayName}>`,
      'customCheckoutSdk' in ctx
    );

    // For every event where the merchant provides a callback, call element.on
    // with that callback. If the merchant ever changes the callback, removes
    // the old callback with element.off and then call element.on with the new one.
    useAttachEvent(element, 'blur', onBlur);
    useAttachEvent(element, 'focus', onFocus);
    useAttachEvent(element, 'escape', onEscape);
    useAttachEvent(element, 'click', onClick);
    useAttachEvent(element, 'loaderror', onLoadError);
    useAttachEvent(element, 'loaderstart', onLoaderStart);
    useAttachEvent(element, 'networkschange', onNetworksChange);
    useAttachEvent(element, 'lineitemclick', onLineItemClick);
    useAttachEvent(element, 'confirm', onConfirm);
    useAttachEvent(element, 'cancel', onCancel);
    useAttachEvent(element, 'shippingaddresschange', onShippingAddressChange);
    useAttachEvent(element, 'shippingratechange', onShippingRateChange);

    let readyCallback: UnknownCallback | undefined;
    if (type === 'cart') {
      readyCallback = (event) => {
        setCartState(
          (event as unknown) as stripeJs.StripeCartElementPayloadEvent
        );
        onReady && onReady(event);
      };
    } else if (onReady) {
      if (type === 'expressCheckout') {
        // Passes through the event, which includes visible PM types
        readyCallback = onReady;
      } else {
        // For other Elements, pass through the Element itself.
        readyCallback = () => {
          onReady(element);
        };
      }
    }

    useAttachEvent(element, 'ready', readyCallback);

    const changeCallback =
      type === 'cart'
        ? (event: stripeJs.StripeCartElementPayloadEvent) => {
            setCartState(event);
            onChange && onChange(event);
          }
        : onChange;

    useAttachEvent(element, 'change', changeCallback);

    const checkoutCallback =
      type === 'cart'
        ? (event: stripeJs.StripeCartElementPayloadEvent) => {
            setCartState(event);
            onCheckout && onCheckout(event);
          }
        : onCheckout;

    useAttachEvent(element, 'checkout', checkoutCallback);

    React.useLayoutEffect(() => {
      if (
        elementRef.current === null &&
        domNode.current !== null &&
        (elements || customCheckoutSdk)
      ) {
        let newElement: stripeJs.StripeElement | null = null;
        if (customCheckoutSdk) {
          newElement = customCheckoutSdk.createElement(type as any, options);
        } else if (elements) {
          newElement = elements.create(type as any, options);
        }

        if (type === 'cart' && setCart) {
          // we know that elements.create return value must be of type StripeCartElement if type is 'cart',
          // we need to cast because typescript is not able to infer which overloaded method is used based off param type
          setCart((newElement as unknown) as stripeJs.StripeCartElement);
        }

        // Store element in a ref to ensure it's _immediately_ available in cleanup hooks in StrictMode
        elementRef.current = newElement;
        // Store element in state to facilitate event listener attachment
        setElement(newElement);

        if (newElement) {
          newElement.mount(domNode.current);
        }
    const callOnReady = useCallbackReference(onReady);
    const callOnBlur = useCallbackReference(onBlur);
    const callOnFocus = useCallbackReference(onFocus);
    const callOnClick = useCallbackReference(onClick);
    const callOnChange = useCallbackReference(onChange);
    const callOnEscape = useCallbackReference(onEscape);
    const callOnLoadError = useCallbackReference(onLoadError);
    const callOnLoaderStart = useCallbackReference(onLoaderStart);
    const callOnNetworksChange = useCallbackReference(onNetworksChange);

    React.useLayoutEffect(() => {
      if (elementRef.current == null && elements && domNode != null) {
        const element = elements.create(type as any, options);
        elementRef.current = element;
        element.mount(domNode);
        element.on('ready', () => callOnReady(element));
        element.on('change', callOnChange);
        element.on('blur', callOnBlur);
        element.on('focus', callOnFocus);
        element.on('escape', callOnEscape);

        // Users can pass an onLoadError prop on any Element component
        // just as they could listen for the `loaderror` event on any Element,
        // but only certain Elements will trigger the event.
        (element as any).on('loaderror', callOnLoadError);

        // Users can pass an onLoaderStart prop on any Element component
        // just as they could listen for the `loaderstart` event on any Element,
        // but only certain Elements will trigger the event.
        (element as any).on('loaderstart', callOnLoaderStart);

        // Users can pass an onNetworksChange prop on any Element component
        // just as they could listen for the `networkschange` event on any Element,
        // but only the Card and CardNumber Elements will trigger the event.
        (element as any).on('networkschange', callOnNetworksChange);

        // Users can pass an onClick prop on any Element component
        // just as they could listen for the `click` event on any Element,
        // but only the PaymentRequestButton will actually trigger the event.
        (element as any).on('click', callOnClick);
      }
    }, [elements, customCheckoutSdk, options, setCart]);

    const prevOptions = usePrevious(options);
    React.useEffect(() => {
      if (!elementRef.current) {
        return;
      }

      const updates = extractAllowedOptionsUpdates(options, prevOptions, [
        'paymentRequest',
      ]);

      if (updates) {
        elementRef.current.update(updates);
      }
    }, [options, prevOptions]);

    React.useLayoutEffect(() => {
      return () => {
        if (
          elementRef.current &&
          typeof elementRef.current.destroy === 'function'
        ) {
          try {
            elementRef.current.destroy();
            elementRef.current = null;
          } catch (error) {
            // Do nothing
          }
        }
      };
    }, []);

    useClassName(domNode, className);

    return <div id={id} ref={setDomNode} />;
  };

  // Only render the Element wrapper in a server environment.
  const ServerElement: FunctionComponent<PrivateElementProps> = (props) => {
    // Validate that we are in the right context by calling useElementsContextWithUseCase.
    const ctx = useElementsOrCustomCheckoutSdkContextWithUseCase(
      `mounts <${displayName}>`
    );

    useCartElementContextWithUseCase(
      `mounts <${displayName}>`,
      'customCheckoutSdk' in ctx
    );
    const {id, className} = props;
    return <div id={id} className={className} />;
  };

  const Element = isServer ? ServerElement : ClientElement;

  Element.propTypes = {
    id: PropTypes.string,
    className: PropTypes.string,
    onChange: PropTypes.func,
    onBlur: PropTypes.func,
    onFocus: PropTypes.func,
    onReady: PropTypes.func,
    onEscape: PropTypes.func,
    onClick: PropTypes.func,
    onLoadError: PropTypes.func,
    onLoaderStart: PropTypes.func,
    onNetworksChange: PropTypes.func,
    onCheckout: PropTypes.func,
    onLineItemClick: PropTypes.func,
    onConfirm: PropTypes.func,
    onCancel: PropTypes.func,
    onShippingAddressChange: PropTypes.func,
    onShippingRateChange: PropTypes.func,
    options: PropTypes.object as any,
  };

  Element.displayName = displayName;
  (Element as any).__elementType = type;

  return Element as FunctionComponent<ElementProps>;
};

export default createElementComponent;

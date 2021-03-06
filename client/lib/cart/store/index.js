/**
 * External dependencies
 */
var assign = require( 'lodash/assign' ),
	partialRight = require( 'lodash/partialRight' ),
	flowRight = require( 'lodash/flowRight' ),
	flow = require( 'lodash/flow' );

/**
 * Internal dependencies
 */
var UpgradesActionTypes = require( 'lib/upgrades/constants' ).action,
	emitter = require( 'lib/mixins/emitter' ),
	sites = require( 'lib/sites-list' )(),
	cartSynchronizer = require( './cart-synchronizer' ),
	wpcom = require( 'lib/wp' ).undocumented(),
	PollerPool = require( 'lib/data-poller' ),
	cartAnalytics = require( './cart-analytics' ),
	productsList = require( 'lib/products-list' )(),
	Dispatcher = require( 'dispatcher' ),
	cartValues = require( 'lib/cart-values' ),
	applyCoupon = cartValues.applyCoupon,
	cartItems = cartValues.cartItems;

var _cartKey = null,
	_synchronizer = null,
	_poller = null;

var CartStore = {
	get: function() {
		var value = hasLoadedFromServer() ? _synchronizer.getLatestValue() : {};

		return assign( {}, value, {
			hasLoadedFromServer: hasLoadedFromServer(),
			hasPendingServerUpdates: hasPendingServerUpdates()
		} );
	}
};

emitter( CartStore );

function hasLoadedFromServer() {
	return ( _synchronizer && _synchronizer.hasLoadedFromServer() );
}

function hasPendingServerUpdates() {
	return ( _synchronizer && _synchronizer.hasPendingServerUpdates() );
}

function setSelectedSite() {
	var selectedSite = sites.getSelectedSite();

	if ( selectedSite && _cartKey === selectedSite.ID ) {
		return;
	}

	if ( ! selectedSite ) {
		_cartKey = 'no-site';
	} else {
		_cartKey = selectedSite.ID;
	}

	if ( _synchronizer && _poller ) {
		PollerPool.remove( _poller );
		_synchronizer.off( 'change', emitChange );
	}

	_synchronizer = cartSynchronizer( _cartKey, wpcom );
	_synchronizer.on( 'change', emitChange );

	_poller = PollerPool.add( CartStore, _synchronizer._poll.bind( _synchronizer ) );
}

function emitChange() {
	CartStore.emit( 'change' );
}

function update( changeFunction ) {
	var wrappedFunction,
		previousCart,
		nextCart;

	wrappedFunction = flowRight(
		partialRight( cartValues.fillInAllCartItemAttributes, productsList.get() ),
		changeFunction
	);

	previousCart = CartStore.get();
	nextCart = wrappedFunction( previousCart );

	_synchronizer.update( wrappedFunction );
	cartAnalytics.recordEvents( previousCart, nextCart );
}

function disable() {
	if ( _synchronizer && _poller ) {
		PollerPool.remove( _poller );
		_synchronizer.off( 'change', emitChange );
	}

	_synchronizer = null;
	_poller = null;
	_cartKey = null;
}

CartStore.dispatchToken = Dispatcher.register( ( payload ) => {
	const { action } = payload;

	switch ( action.type ) {
		case UpgradesActionTypes.CART_DISABLE:
			disable();
			break;

		case UpgradesActionTypes.CART_PRIVACY_PROTECTION_ADD:
			update( cartItems.addPrivacyToAllDomains( CartStore.get() ) );
			break;

		case UpgradesActionTypes.CART_PRIVACY_PROTECTION_REMOVE:
			update( cartItems.removePrivacyFromAllDomains( CartStore.get() ) );
			break;

		case UpgradesActionTypes.CART_ITEMS_ADD:
			update( flow( ...action.cartItems.map( cartItem => cartItems.add( cartItem ) ) ) );
			break;

		case UpgradesActionTypes.CART_COUPON_APPLY:
			update( applyCoupon( action.coupon ) );
			break;

		case UpgradesActionTypes.CART_ITEM_REMOVE:
			update( cartItems.removeItemAndDependencies( action.cartItem, CartStore.get(), action.domainsWithPlansOnly ) );
			break;
	}
} );

sites.on( 'change', setSelectedSite );

if ( sites.fetched ) {
	setSelectedSite();
}

module.exports = CartStore;

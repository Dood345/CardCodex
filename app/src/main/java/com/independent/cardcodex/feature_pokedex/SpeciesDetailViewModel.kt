package com.independent.cardcodex.feature_pokedex

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardCollectionEntity
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.CardWithQuantity
import com.independent.cardcodex.core_database.CollectionDao
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SpeciesDetailViewModel @Inject constructor(
    private val cardDao: CardDao,
    private val collectionDao: CollectionDao
) : ViewModel() {

    fun getCardsForSpecies(speciesId: Int): Flow<List<CardWithQuantity>> {
        return cardDao.getCardsWithQuantityForSpecies(speciesId)
    }

    fun getCardsByName(name: String): Flow<List<CardWithQuantity>> {
        return cardDao.getCardsWithQuantityByName(name)
    }

    fun updateQuantity(cardId: String, newQuantity: Int) {
        viewModelScope.launch {
            collectionDao.insertOrUpdate(CardCollectionEntity(cardId, newQuantity))
        }
    }
}

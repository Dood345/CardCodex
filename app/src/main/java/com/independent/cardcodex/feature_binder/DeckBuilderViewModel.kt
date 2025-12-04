package com.independent.cardcodex.feature_binder

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.CardWithAvailability
import com.independent.cardcodex.core_database.CardWithDeckQuantity
import com.independent.cardcodex.core_database.DeckCardCrossRef
import com.independent.cardcodex.core_database.DeckDao
import com.independent.cardcodex.core_database.DeckEntity
import com.independent.cardcodex.feature_pokedex.CodexCategory
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DeckBuilderViewModel @Inject constructor(
    private val cardDao: CardDao,
    private val deckDao: DeckDao
) : ViewModel() {

    private val _deckId = MutableStateFlow<Long>(-1)

    @OptIn(ExperimentalCoroutinesApi::class)
    val currentDeckCards: StateFlow<List<CardWithDeckQuantity>> = _deckId.flatMapLatest { id ->
        if (id != -1L) deckDao.getCardsInDeck(id) else flowOf(emptyList())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val deckName: StateFlow<String> = _deckId.flatMapLatest { id ->
        if (id != -1L) deckDao.getDeckWithCards(id).map { it.deck.name } else flowOf("Deck Builder")
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "Loading...")

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _selectedCategory = MutableStateFlow(CodexCategory.All)
    val selectedCategory: StateFlow<CodexCategory> = _selectedCategory.asStateFlow()

    // All cards with their availability status, filtered
    // Note: CardDao.getAllCardsWithAvailability() already subtracts used cards in DB query.
    // So we just need to filter/sort.
    val libraryCards: StateFlow<List<CardWithAvailability>> = combine(
        cardDao.getAllCardsWithAvailability(),
        _searchQuery,
        _selectedCategory
    ) { cards, query, category ->
        cards
            .filter { it.card.name.contains(query, ignoreCase = true) }
            .filter { cardWithAvail ->
                when (category) {
                    CodexCategory.All -> true
                    CodexCategory.Pokemon -> cardWithAvail.card.supertype == "Pokémon"
                    CodexCategory.Trainer -> cardWithAvail.card.supertype == "Trainer"
                    CodexCategory.Energy -> cardWithAvail.card.supertype == "Energy"
                }
            }
            .sortedBy { it.card.name }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun loadDeck(deckId: Long) {
        _deckId.value = deckId
    }

    fun addCardToDeck(cardId: String) {
        val deckId = _deckId.value
        if (deckId == -1L) return
        
        viewModelScope.launch {
            val existingRef = deckDao.getDeckCardCrossRef(deckId, cardId)
            if (existingRef != null) {
                deckDao.updateDeckCardCrossRef(existingRef.copy(quantity = existingRef.quantity + 1))
            } else {
                deckDao.insertDeckCardCrossRef(DeckCardCrossRef(deckId, cardId, 1))
            }
        }
    }

    fun removeCardFromDeck(cardId: String) {
        val deckId = _deckId.value
        if (deckId == -1L) return

        viewModelScope.launch {
            val existingRef = deckDao.getDeckCardCrossRef(deckId, cardId) ?: return@launch
            if (existingRef.quantity > 1) {
                deckDao.updateDeckCardCrossRef(existingRef.copy(quantity = existingRef.quantity - 1))
            } else {
                deckDao.deleteDeckCardCrossRef(existingRef)
            }
        }
    }

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
    }

    fun onCategorySelect(category: CodexCategory) {
        _selectedCategory.value = category
    }
}

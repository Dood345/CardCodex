package com.independent.cardcodex.feature_binder

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.DeckCardCrossRef
import com.independent.cardcodex.core_database.DeckDao
import com.independent.cardcodex.core_database.DeckEntity
import com.independent.cardcodex.core_database.DeckWithCards
import com.independent.cardcodex.domain.DeckImportUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DeckDetailViewModel @Inject constructor(
    private val deckDao: DeckDao,
    private val importUseCase: DeckImportUseCase
) : ViewModel() {

    private val _deck = MutableStateFlow<DeckWithCards?>(null)
    val deck: StateFlow<DeckWithCards?> = _deck.asStateFlow()

    fun loadDeck(deckId: Long) {
        viewModelScope.launch {
            deckDao.getDeckWithCards(deckId).collect {
                _deck.value = it
            }
        }
    }

    fun importDeck(deckId: Long, text: String) {
        viewModelScope.launch {
            val result = importUseCase(text)
            result.cards.forEach { parsedCard ->
                deckDao.insertDeckCardCrossRef(
                    DeckCardCrossRef(
                        deckId = deckId,
                        cardId = parsedCard.card.cardId,
                        quantity = parsedCard.quantity
                    )
                )
            }
            // Handle not found lines?
        }
    }
}

package com.independent.cardcodex.feature_binder

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.DeckDao
import com.independent.cardcodex.core_database.DeckEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DecksViewModel @Inject constructor(
    private val deckDao: DeckDao
) : ViewModel() {

    val decks: StateFlow<List<DeckEntity>> = deckDao.getAllDecks()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun createDeck(name: String) {
        viewModelScope.launch {
            deckDao.insertDeck(DeckEntity(name = name))
        }
    }
}

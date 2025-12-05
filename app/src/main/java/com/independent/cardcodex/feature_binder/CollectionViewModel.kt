package com.independent.cardcodex.feature_binder

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.feature_pokedex.CodexCategory
import com.independent.cardcodex.feature_pokedex.CodexEntry
import com.independent.cardcodex.ui.util.EnergyIconProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class CollectionViewModel @Inject constructor(
    private val cardDao: CardDao,
    private val energyIconProvider: EnergyIconProvider
) : ViewModel() {

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _selectedCategories = MutableStateFlow<Set<CodexCategory>>(setOf(CodexCategory.All))
    val selectedCategories: StateFlow<Set<CodexCategory>> = _selectedCategories.asStateFlow()

    val collectionEntries: StateFlow<List<CodexEntry>> = combine(
        cardDao.getSpeciesCollectionStatus(),
        cardDao.getAllUncategorizedCardsWithStatus(),
        _searchQuery,
        _selectedCategories
    ) { speciesStatusList, uncategorizedList, query, categories ->
        // 1. Map Species (Owned & Unowned)
        val speciesEntries = speciesStatusList
            .map { status ->
                CodexEntry(
                    id = status.species.id.toString(),
                    name = status.species.name,
                    iconUrl = status.species.iconUrl,
                    type = status.species.types.firstOrNull(),
                    isSpecies = true,
                    speciesId = status.species.id,
                    isOwned = status.isOwned
                )
            }

        // 2. Map Uncategorized (Trainers/Energy) - Owned & Unowned
        val otherEntries = uncategorizedList.map { status ->
            val card = status.card
            val isOwned = status.isOwned
            var iconUrl = card.imageUrl
            
            if (card.supertype == "Energy") {
                 val energyType = card.name.substringBefore(" Energy").trim()
                 // Only use the energy icon provider if we have a mapping, or fallback to card image
                 // If not owned, we might override this below
                 iconUrl = energyIconProvider.getIconUrl(energyType) ?: card.imageUrl
            }

            if (!isOwned) {
                if (card.supertype == "Trainer") {
                    iconUrl = "placeholder:trainer"
                } else if (card.supertype == "Energy") {
                    iconUrl = "placeholder:energy"
                }
            }

            CodexEntry(
                id = card.name, // Grouping key
                name = card.name,
                iconUrl = iconUrl,
                type = card.supertype ?: "Trainer",
                isSpecies = false,
                speciesId = null,
                isOwned = isOwned
            )
        }

        val allEntries = speciesEntries + otherEntries

        // 3. Filter & Sort
        allEntries
            .filter { entry -> 
                (query.isBlank() || entry.name.contains(query, ignoreCase = true)) &&
                (categories.contains(CodexCategory.All) || 
                 categories.any { category ->
                    when (category) {
                        CodexCategory.Pokemon -> entry.isSpecies
                        CodexCategory.Trainer -> !entry.isSpecies && entry.type == "Trainer"
                        CodexCategory.Energy -> !entry.isSpecies && entry.type == "Energy"
                        else -> false
                    }
                 })
            }
            .sortedWith(compareBy<CodexEntry> { 
                when {
                    it.isSpecies -> 0
                    it.type == "Trainer" -> 1
                    it.type == "Energy" -> 2
                    else -> 3
                }
            }.thenBy { 
                if (it.isSpecies) it.speciesId else 0 
            }.thenBy { 
                it.name 
            })

    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
    }

    fun onCategorySelect(category: CodexCategory) {
        _selectedCategories.value = if (category == CodexCategory.All) {
            setOf(CodexCategory.All)
        } else {
            val current = _selectedCategories.value.toMutableSet()
            if (current.contains(CodexCategory.All)) {
                current.remove(CodexCategory.All)
            }
            
            if (current.contains(category)) {
                current.remove(category)
            } else {
                current.add(category)
            }
            
            if (current.isEmpty()) {
                setOf(CodexCategory.All)
            } else {
                current
            }
        }
    }
}
